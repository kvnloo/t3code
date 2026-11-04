#!/usr/bin/env bash
# Runs inside fleet-runner from the root of a kvnloo/t3code source archive.
# Needs T3_CHANNEL=nightly|preview. Produces android-result/*.apk (debug-signed; re-signed locally).
set -euo pipefail
mkdir -p .fleet-tools
curl --fail --retry 3 -L https://nodejs.org/dist/v26.12.1/node-v26.12.1-linux-x64.tar.xz -o .fleet-tools/node.tar.xz
tar -xJf .fleet-tools/node.tar.xz -C .fleet-tools
export PATH="$PWD/.fleet-tools/node-v26.12.1-linux-x64/bin:$PATH"
npm install --global pnpm@12.14.0
export CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 EXPO_NO_GIT_STATUS=1
export APP_VARIANT="$T3_CHANNEL" T3CODE_MOBILE_UPDATES_ENABLED=0 MOBILE_VERSION_POLICY=appVersion
# Sign in + relay, same public client config as the stable app (see public-client-config.env).
export T3CODE_RELAY_URL=https://relay.t3.codes
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsudDMuY29kZXMk
export EXPO_PUBLIC_CLERK_JWT_TEMPLATE=t3-relay
export EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID=833042137903-fa4j7fh4b4fh7ak7keq79k2sdenfp0k7.apps.googleusercontent.com
export EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID=833042137903-rgmk8a3ovglllsfs7gvf1urng49jveup.apps.googleusercontent.com
export EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID=833042137903-5guqq7e2mq52jurn0io46ihlidja7bnr.apps.googleusercontent.com
export EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.833042137903-rgmk8a3ovglllsfs7gvf1urng49jveup
pnpm install --no-frozen-lockfile --filter . --filter @t3tools/mobile...
mkdir -p android-result
tests="app.config.test.ts"
for t in src/lib/desktopColors.test.ts src/lib/windowGlass.test.ts src/lib/mobileTheme.test.ts src/lib/nativeTheme.test.ts; do
  test -f "apps/mobile/$t" && tests="$tests $t"
done
# The fork's nightly variant is not in app.t3.codes' universal-link list, so skip that one upstream check.
(cd apps/mobile && ../../node_modules/.bin/vp test run $tests -t '^(?!.*APP_VARIANT="nightly").*$') > android-result/mobile-unit.log 2>&1 || { cat android-result/mobile-unit.log; exit 1; }
for t in apps/mobile/src/lib/openUiMarkdown.node-test.ts packages/client-runtime/src/openUiCharts.node-test.ts; do
  test -f "$t" && { node --test "$t" >> android-result/mobile-unit.log 2>&1 || { cat android-result/mobile-unit.log; exit 1; }; }
done
pnpm --filter @t3tools/mobile generate
curl --fail --retry 3 -L https://github.com/WebAssembly/wabt/releases/download/1.0.42/wabt-1.0.42-linux-x64.tar.gz -o .fleet-tools/wabt.tar.gz
mkdir -p .fleet-tools/wabt
tar -xzf .fleet-tools/wabt.tar.gz -C .fleet-tools/wabt --strip-components=1
export WASM2C="$PWD/.fleet-tools/wabt/bin/wasm2c"
pnpm --filter @t3tools/mobile generate:highlights
pnpm --filter @t3tools/mobile typecheck > android-result/mobile-typecheck.log 2>&1 || { cat android-result/mobile-typecheck.log; exit 1; }
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
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=4 -Dorg.gradle.jvmargs='-Xmx6g -XX:MaxMetaspaceSize=2g' > ../../../android-result/android-build.log 2>&1 || { tail -n 160 ../../../android-result/android-build.log; exit 1; }
cd ../../..
cp apps/mobile/android/app/build/outputs/apk/release/*.apk "android-result/t3code-$T3_CHANNEL.apk"
sha256sum android-result/*.apk > android-result/SHA256SUMS
