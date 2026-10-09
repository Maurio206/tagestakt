// Generiert von apps/mobile/plugins/with-android-widget.js – nicht von Hand ändern.
package {{PACKAGE}}.widget

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Brücke für apps/mobile/src/lib/home-widget.ts: legt die bereinigte Zeitleiste app-intern ab
 * bzw. löscht sie und zeichnet die Widgets sofort neu. Fehlermeldungen ohne Inhalte.
 */
class TagesTaktWidgetModule(context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName(): String = NAME

  @ReactMethod
  fun setData(json: String, promise: Promise) {
    if (!WidgetPayload.isValid(json)) {
      promise.reject("widget_payload_invalid", "Widget-Daten ungültig.")
      return
    }
    try {
      val context = reactApplicationContext
      if (!WidgetStore.write(context, json)) {
        promise.reject("widget_store_failed", "Widget-Daten konnten nicht gespeichert werden.")
        return
      }
      TagesTaktWidgetProvider.refreshAll(context)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("widget_update_failed", "Widget konnte nicht aktualisiert werden.")
    }
  }

  @ReactMethod
  fun clear(promise: Promise) {
    try {
      val context = reactApplicationContext
      val cleared = WidgetStore.clear(context)
      TagesTaktWidgetProvider.refreshAll(context)
      if (cleared) promise.resolve(true)
      else promise.reject("widget_clear_failed", "Widget-Daten konnten nicht gelöscht werden.")
    } catch (e: Exception) {
      promise.reject("widget_clear_failed", "Widget-Daten konnten nicht gelöscht werden.")
    }
  }

  companion object {
    const val NAME = "TagesTaktWidget"
  }
}
