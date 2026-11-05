const { withAndroidManifest } = require("expo/config-plugins");

function addMailtoSendtoQuery(manifest) {
  manifest.queries ??= [];
  const hasEmailQuery = manifest.queries.some((query) =>
    query.intent?.some(
      (intent) =>
        intent.action?.some(
          (action) => action.$?.["android:name"] === "android.intent.action.SENDTO",
        ) && intent.data?.some((data) => data.$?.["android:scheme"] === "mailto"),
    ),
  );
  if (!hasEmailQuery) {
    manifest.queries.push({
      intent: [
        {
          action: [{ $: { "android:name": "android.intent.action.SENDTO" } }],
          data: [{ $: { "android:scheme": "mailto" } }],
        },
      ],
    });
  }
  return manifest;
}

module.exports = function withAndroidMailtoQueries(config) {
  return withAndroidManifest(config, (nextConfig) => {
    addMailtoSendtoQuery(nextConfig.modResults.manifest);
    return nextConfig;
  });
};

module.exports.addMailtoSendtoQuery = addMailtoSendtoQuery;
