package expo.modules.t3nativecontrols

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.WindowManager
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

private const val DESKTOP_COLORS_PREFS = "t3_desktop_colors"
private const val DESKTOP_COLORS_KEY = "colors"

/**
 * See-through window and desktop colors for Android.
 *
 * `setGlass(true, blurDp)` shows the wallpaper (live wallpapers included) behind the app and, where
 * the platform allows cross-window blur (API 31+, not in battery saver, not on most Samsung builds),
 * blurs it. `setGlass(false, 0)` restores the opaque window exactly as the theme created it.
 *
 * Desktop colors arrive through [T3DesktopColorsReceiver] and are read with `readDesktopColors`.
 */
class T3WindowGlassModule : Module() {
  private var original: OriginalWindow? = null

  override fun definition() = ModuleDefinition {
    Name("T3WindowGlass")
    Events("onDesktopColorsChange")

    Function("readDesktopColors") {
      appContext.reactContext
        ?.getSharedPreferences(DESKTOP_COLORS_PREFS, Context.MODE_PRIVATE)
        ?.getString(DESKTOP_COLORS_KEY, null)
    }

    Function("clearDesktopColors") {
      appContext.reactContext
        ?.getSharedPreferences(DESKTOP_COLORS_PREFS, Context.MODE_PRIVATE)
        ?.edit()
        ?.remove(DESKTOP_COLORS_KEY)
        ?.apply()
    }

    AsyncFunction("setGlass") { enabled: Boolean, blurDp: Double ->
      val activity = appContext.currentActivity ?: return@AsyncFunction state(null)
      if (enabled) applyGlass(activity, blurDp) else restore(activity)
      state(activity)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("state") { -> state(appContext.currentActivity) }.runOnQueue(Queues.MAIN)

    OnStartObserving {
      desktopColorsListener = { json -> sendEvent("onDesktopColorsChange", mapOf("colors" to json)) }
    }
    OnStopObserving { desktopColorsListener = null }
  }

  private fun applyGlass(activity: Activity, blurDp: Double) {
    val window = activity.window
    if (original == null) {
      // Window pixel format alone does not release the Activity's opaque surface.
      // Convert it now so Settings does not need a background/resume to reveal wallpaper.
      val background = window.decorView.background
      val format = window.attributes.format
      val restoreOpacity = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
        activity.setTranslucent(true)
      original = OriginalWindow(background, format, restoreOpacity)
    }
    window.setFormat(PixelFormat.TRANSLUCENT)
    window.setBackgroundDrawable(ColorDrawable(android.graphics.Color.TRANSPARENT))
    window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val px = if (blurSupported(activity)) {
        (blurDp.coerceIn(0.0, 120.0) * activity.resources.displayMetrics.density).toInt()
      } else {
        0
      }
      window.setBackgroundBlurRadius(px)
    }
    window.decorView.postDelayed({ logOpaqueBackgrounds(window.decorView, 0) }, 1500)
  }

  // Experiment diagnostics: every full-width view that paints a background, so an opaque layer
  // hiding the wallpaper can be found in logcat (`adb logcat -s T3WindowGlass`).
  private fun logOpaqueBackgrounds(view: android.view.View, depth: Int) {
    if (depth > 40) return
    val background = view.background
    if (background != null && view.width >= view.rootView.width / 2 && view.visibility == android.view.View.VISIBLE) {
      val color = (background as? ColorDrawable)?.color?.let { String.format("#%08X", it) }
      android.util.Log.i(
        "T3WindowGlass",
        "${" ".repeat(depth)}${view.javaClass.simpleName} ${view.width}x${view.height} " +
          "bg=${background.javaClass.simpleName} color=$color opacity=${background.opacity} alpha=${view.alpha}"
      )
    }
    if (view is android.view.ViewGroup) {
      for (index in 0 until view.childCount) logOpaqueBackgrounds(view.getChildAt(index), depth + 1)
    }
  }

  private fun restore(activity: Activity) {
    val saved = original ?: return
    val window = activity.window
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) window.setBackgroundBlurRadius(0)
    window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER)
    window.setBackgroundDrawable(saved.background)
    window.setFormat(saved.format)
    if (saved.restoreOpacity && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      activity.setTranslucent(false)
    }
    original = null
  }

  private fun blurSupported(activity: Activity): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && activity.windowManager.isCrossWindowBlurEnabled

  private fun state(activity: Activity?): Map<String, Any> = mapOf(
    "blurSupported" to (activity != null && blurSupported(activity)),
    "showsWallpaper" to (
      activity != null &&
        (activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER) != 0
      )
  )

  private data class OriginalWindow(
    val background: Drawable?,
    val format: Int,
    val restoreOpacity: Boolean,
  )

  companion object {
    @Volatile
    internal var desktopColorsListener: ((String) -> Unit)? = null
  }
}

/**
 * Receives desktop colors, for example from a dotfiles hook on the computer:
 *
 *   adb shell am broadcast -f 0x20 -n <package>/expo.modules.t3nativecontrols.T3DesktopColorsReceiver \
 *     --es surface 181f23 --es onSurface d1deda --es primary c8be72
 *
 * Every string extra is stored as-is; the app validates the roles it understands.
 */
class T3DesktopColorsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val extras = intent.extras ?: return
    val colors = JSONObject()
    for (key in extras.keySet()) {
      extras.getString(key)?.let { colors.put(key, it) }
    }
    if (colors.length() == 0) return
    val json = colors.toString()
    context.getSharedPreferences(DESKTOP_COLORS_PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(DESKTOP_COLORS_KEY, json)
      .apply()
    T3WindowGlassModule.desktopColorsListener?.invoke(json)
    resultCode = 1
  }
}
