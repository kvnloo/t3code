#!/usr/bin/env bash
set -euo pipefail
mkdir -p .fleet-tools
curl --fail --retry 3 -L https://nodejs.org/dist/v26.12.1/node-v26.12.1-linux-x64.tar.xz -o .fleet-tools/node.tar.xz
tar -xJf .fleet-tools/node.tar.xz -C .fleet-tools
export PATH="$PWD/.fleet-tools/node-v26.12.1-linux-x64/bin:$PATH"
npm install --global pnpm@12.14.0
node --version
pnpm --version
export CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 EXPO_NO_GIT_STATUS=1
export APP_VARIANT=preview T3_OPENUI_LAB_BUILD=1 T3CODE_MOBILE_UPDATES_ENABLED=0 MOBILE_VERSION_POLICY=appVersion
pnpm install --no-frozen-lockfile --filter @t3tools/mobile... --filter @t3tools/web...
node --test apps/mobile/src/lib/openUiMarkdown.node-test.ts
node experiments/openui-lab/run-smoke.mjs openui-smoke 2>&1 | tee openui-smoke.log
pnpm --filter @t3tools/mobile generate
curl --fail --retry 3 -L https://github.com/WebAssembly/wabt/releases/download/1.0.42/wabt-1.0.42-linux-x64.tar.gz -o .fleet-tools/wabt.tar.gz
mkdir -p .fleet-tools/wabt
tar -xzf .fleet-tools/wabt.tar.gz -C .fleet-tools/wabt --strip-components=1
export WASM2C="$PWD/.fleet-tools/wabt/bin/wasm2c"
pnpm --filter @t3tools/mobile generate:highlights
pnpm --filter @t3tools/mobile typecheck > mobile-typecheck.log 2>&1 || { cat mobile-typecheck.log; exit 1; }
export JAVA_HOME="${JAVA_HOME_17_X64:-${JAVA_HOME:-/usr/lib/jvm/temurin-17-jdk-amd64}}"
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/android-sdk}}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
if ! test -d "$ANDROID_HOME/cmdline-tools"; then
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  curl --fail --retry 3 -L https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip -o .fleet-tools/android-cli.zip
  unzip -q .fleet-tools/android-cli.zip -d "$ANDROID_HOME/cmdline-tools"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
set +o pipefail
yes | sdkmanager --licenses >/dev/null
set -o pipefail
cd apps/mobile
pnpm exec expo prebuild --platform android --no-install
cd android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=6 -Dorg.gradle.jvmargs='-Xmx8g -XX:MaxMetaspaceSize=2g' > ../../../android-build.log 2>&1 || { tail -n 160 ../../../android-build.log; exit 1; }
cd ../../..
mkdir -p android-result
cp apps/mobile/android/app/build/outputs/apk/release/*.apk android-result/
cp mobile-typecheck.log android-build.log openui-smoke.log android-result/
sha256sum android-result/*.apk > android-result/SHA256SUMS
