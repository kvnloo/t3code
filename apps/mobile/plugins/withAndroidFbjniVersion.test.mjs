import { describe, expect, it } from "vitest";
import withAndroidFbjniVersion from "./withAndroidFbjniVersion.cjs";

const buildGradle = `buildscript {
  repositories {
    google()
    mavenCentral()
  }
}

allprojects {
  repositories {
    google()
    mavenCentral()
  }
}
`;

async function transform(contents, language = "groovy") {
  const config = withAndroidFbjniVersion({ name: "Test", slug: "test" });
  const result = await config.mods.android.projectBuildGradle({
    ...config,
    modRequest: { platform: "android", modName: "projectBuildGradle", introspect: false },
    modResults: { language, contents },
  });
  return result.modResults.contents;
}

describe("Android fbjni version generation", () => {
  it("forces the React Native fbjni version and stays idempotent", async () => {
    const generated = await transform(buildGradle);

    expect(generated).toContain(
      "resolutionStrategy.force 'com.facebook.fbjni:fbjni:0.7.0'",
    );
    expect(await transform(generated)).toBe(generated);
  });

  it("fails visibly if Expo switches the project build file away from Groovy", async () => {
    await expect(transform(buildGradle, "kotlin")).rejects.toThrow(
      "project build.gradle must use Groovy",
    );
  });
});
