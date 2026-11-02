// PoH bench-only LD_PRELOAD tap: counts the server's SQLite write syscalls by file so a simulated
// turn's storage writes split into WAL frames (per commit) and checkpoint copy-back into the DB.
// Build: cc -O2 -shared -fPIC -o iotap.so bench/poh/iotap.c -ldl
// Use:   LD_PRELOAD=iotap.so POH_IOTAP_DIR=<dir>; counters live in <dir>/<pid>.iotap as
//        little-endian uint64s (see COUNTER_NAMES in bench/poh/iotap.ts). Children get their own file.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <unistd.h>

enum {
  WAL_BYTES, WAL_WRITES, WAL_FRAMES, WAL_COMMITS, WAL_HEADERS,
  DB_BYTES, DB_WRITES, SHM_BYTES, OTHER_BYTES, WAL_SYNCS, DB_SYNCS, JOURNAL_BYTES,
  N_COUNTERS = 16
};
enum { K_NONE = 0, K_WAL, K_DB, K_SHM, K_JOURNAL, K_OTHER };

#define MAX_FD 65536
static unsigned char kinds[MAX_FD];
static uint64_t *counters;
static pid_t owner;
static int pages_fd = -1; // <dir>/<pid>.pages when POH_IOTAP_PAGES=1: u32 pgno, u32 commit size per frame

static void attach(void) {
  pid_t pid = getpid();
  if (counters != NULL && owner == pid) return;
  counters = NULL;
  owner = pid;
  const char *dir = getenv("POH_IOTAP_DIR");
  if (dir == NULL) return;
  char path[4096];
  snprintf(path, sizeof path, "%s/%d.iotap", dir, (int)pid);
  static int (*real_open)(const char *, int, ...);
  if (!real_open) real_open = dlsym(RTLD_NEXT, "open");
  int fd = real_open(path, O_RDWR | O_CREAT | O_CLOEXEC, 0644);
  if (fd < 0) return;
  if (ftruncate(fd, N_COUNTERS * sizeof(uint64_t)) == 0) {
    void *map = mmap(NULL, N_COUNTERS * sizeof(uint64_t), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (map != MAP_FAILED) counters = map;
  }
  close(fd);
  if (getenv("POH_IOTAP_PAGES") != NULL) {
    snprintf(path, sizeof path, "%s/%d.pages", dir, (int)pid);
    pages_fd = real_open(path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
  }
}

static void add(int i, uint64_t n) {
  attach();
  if (counters) __atomic_fetch_add(&counters[i], n, __ATOMIC_RELAXED);
}

static int ends(const char *s, const char *suffix) {
  size_t a = strlen(s), b = strlen(suffix);
  return a >= b && strcmp(s + a - b, suffix) == 0;
}

static void classify(int fd, const char *path) {
  if (fd < 0 || fd >= MAX_FD || path == NULL) return;
  unsigned char k = K_OTHER;
  if (ends(path, ".sqlite-wal")) k = K_WAL;
  else if (ends(path, ".sqlite-shm")) k = K_SHM;
  else if (ends(path, ".sqlite-journal")) k = K_JOURNAL;
  else if (ends(path, ".sqlite")) k = K_DB;
  kinds[fd] = k;
}

static void count(int fd, const void *buf, size_t n, off_t offset) {
  if (fd < 0 || fd >= MAX_FD || kinds[fd] == K_NONE || n == 0) return;
  switch (kinds[fd]) {
    case K_WAL:
      add(WAL_BYTES, n);
      add(WAL_WRITES, 1);
      if (n == 32 && offset == 0) add(WAL_HEADERS, 1);
      // walWriteOneFrame writes the 24-byte frame header separately; bytes 4..7 (the database
      // size after commit) are nonzero only on a transaction's commit frame.
      if (n == 24 && buf != NULL) {
        const unsigned char *h = buf;
        add(WAL_FRAMES, 1);
        if (h[4] | h[5] | h[6] | h[7]) add(WAL_COMMITS, 1);
        if (pages_fd >= 0) {
          static __typeof__(&write) real_write_;
          if (!real_write_) real_write_ = dlsym(RTLD_NEXT, "write");
          uint32_t rec[2] = {(uint32_t)h[0] << 24 | h[1] << 16 | h[2] << 8 | h[3],
                             (uint32_t)h[4] << 24 | h[5] << 16 | h[6] << 8 | h[7]};
          real_write_(pages_fd, rec, sizeof rec);
        }
      }
      break;
    case K_DB: add(DB_BYTES, n); add(DB_WRITES, 1); break;
    case K_SHM: add(SHM_BYTES, n); break;
    case K_JOURNAL: add(JOURNAL_BYTES, n); break;
    default: add(OTHER_BYTES, n); break;
  }
}

#define REAL(name) static __typeof__(&name) real_##name; if (!real_##name) real_##name = dlsym(RTLD_NEXT, #name)

int open(const char *path, int flags, ...) {
  REAL(open);
  mode_t mode = 0;
  if (flags & (O_CREAT | O_TMPFILE)) { va_list ap; va_start(ap, flags); mode = va_arg(ap, mode_t); va_end(ap); }
  int fd = real_open(path, flags, mode);
  classify(fd, path);
  return fd;
}
int open64(const char *path, int flags, ...) {
  REAL(open64);
  mode_t mode = 0;
  if (flags & (O_CREAT | O_TMPFILE)) { va_list ap; va_start(ap, flags); mode = va_arg(ap, mode_t); va_end(ap); }
  int fd = real_open64(path, flags, mode);
  classify(fd, path);
  return fd;
}
int openat(int dirfd, const char *path, int flags, ...) {
  REAL(openat);
  mode_t mode = 0;
  if (flags & (O_CREAT | O_TMPFILE)) { va_list ap; va_start(ap, flags); mode = va_arg(ap, mode_t); va_end(ap); }
  int fd = real_openat(dirfd, path, flags, mode);
  classify(fd, path);
  return fd;
}
int openat64(int dirfd, const char *path, int flags, ...) {
  REAL(openat64);
  mode_t mode = 0;
  if (flags & (O_CREAT | O_TMPFILE)) { va_list ap; va_start(ap, flags); mode = va_arg(ap, mode_t); va_end(ap); }
  int fd = real_openat64(dirfd, path, flags, mode);
  classify(fd, path);
  return fd;
}
int close(int fd) {
  REAL(close);
  if (fd >= 0 && fd < MAX_FD) kinds[fd] = K_NONE;
  return real_close(fd);
}
ssize_t write(int fd, const void *buf, size_t n) {
  REAL(write);
  ssize_t r = real_write(fd, buf, n);
  if (r > 0) count(fd, buf, (size_t)r, -1);
  return r;
}
ssize_t pwrite(int fd, const void *buf, size_t n, off_t offset) {
  REAL(pwrite);
  ssize_t r = real_pwrite(fd, buf, n, offset);
  if (r > 0) count(fd, buf, (size_t)r, offset);
  return r;
}
ssize_t pwrite64(int fd, const void *buf, size_t n, off_t offset) {
  REAL(pwrite64);
  ssize_t r = real_pwrite64(fd, buf, n, offset);
  if (r > 0) count(fd, buf, (size_t)r, offset);
  return r;
}
ssize_t writev(int fd, const struct iovec *iov, int cnt) {
  REAL(writev);
  ssize_t r = real_writev(fd, iov, cnt);
  if (r > 0) count(fd, NULL, (size_t)r, -1);
  return r;
}
ssize_t pwritev(int fd, const struct iovec *iov, int cnt, off_t offset) {
  REAL(pwritev);
  ssize_t r = real_pwritev(fd, iov, cnt, offset);
  if (r > 0) count(fd, NULL, (size_t)r, offset);
  return r;
}
static void synced(int fd) {
  if (fd < 0 || fd >= MAX_FD) return;
  if (kinds[fd] == K_WAL) add(WAL_SYNCS, 1);
  else if (kinds[fd] == K_DB) add(DB_SYNCS, 1);
}
int fsync(int fd) { REAL(fsync); synced(fd); return real_fsync(fd); }
int fdatasync(int fd) { REAL(fdatasync); synced(fd); return real_fdatasync(fd); }
