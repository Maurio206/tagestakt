// Generiert von apps/mobile/plugins/with-android-widget.js – nicht von Hand ändern.
package {{PACKAGE}}.widget

import android.content.Context
import org.json.JSONObject

/**
 * Bereinigte Widget-Daten (Format v1) – Gegenstück zu `buildWidgetTimeline` und
 * `resolveWidgetView` in packages/schedule-schema/src/widget.ts. Enthält nur Texte der Blöcke
 * (Titel bzw. Kategorie, Zeit), Farbtöne und Segmentgrenzen – keine Tokens, keine Notizen.
 */
internal object WidgetPayload {
  const val VERSION = 1
  /** Obergrenze gegen fehlerhafte Aufrufe (übliche Größe: wenige Kilobyte). */
  const val MAX_CHARS = 262_144

  class Current(val free: Boolean, val tone: String, val title: String, val meta: String)

  class Next(val tone: String, val time: String, val text: String)

  sealed class State {
    /** Keine Daten (abgemeldet oder nie angemeldet). */
    object SignedOut : State()

    /** Daten abgelaufen, unbekannt oder beschädigt – nie ein altes Segment zeigen. */
    object Stale : State()

    class Empty(val until: Long) : State()

    class Plan(val until: Long, val current: Current, val next: Next?, val description: String) :
        State()
  }

  fun isValid(json: String): Boolean = json.length <= MAX_CHARS && parse(json) != null

  private fun parse(json: String): JSONObject? =
      try {
        JSONObject(json).takeIf {
          it.optInt("v", -1) == VERSION && it.has("validUntil") && it.optJSONArray("segments") != null
        }
      } catch (e: Exception) {
        null
      }

  /** Segment, das `now` enthält (halboffen [from, until)); sonst neutraler Zustand. */
  fun resolve(json: String?, now: Long): State {
    if (json == null) return State.SignedOut
    val root = parse(json) ?: return State.Stale
    val validUntil = root.optLong("validUntil", 0L)
    if (now >= validUntil) return State.Stale
    val segments = root.getJSONArray("segments")
    for (i in 0 until segments.length()) {
      val segment = segments.optJSONObject(i) ?: continue
      val from = segment.optLong("from", Long.MAX_VALUE)
      val until = segment.optLong("until", Long.MIN_VALUE)
      if (now < from || now >= until) continue
      val end = minOf(until, validUntil)
      return when (segment.optString("kind")) {
        "empty" -> State.Empty(end)
        "plan" -> {
          val current = segment.optJSONObject("current") ?: return State.Stale
          val next = segment.optJSONObject("next")
          State.Plan(
              end,
              Current(
                  current.optString("kind") == "free",
                  current.optString("tone"),
                  current.optString("title"),
                  current.optString("meta"),
              ),
              next?.let { Next(it.optString("tone"), it.optString("time"), it.optString("text")) },
              segment.optString("description"),
          )
        }
        else -> State.Stale
      }
    }
    return State.Stale
  }
}

/** App-interner Speicher des Widgets (SharedPreferences, nur diese App, ohne Backup). */
internal object WidgetStore {
  private const val PREFERENCES = "tagestakt_widget"
  private const val KEY = "payload_v1"

  private fun preferences(context: Context) =
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun read(context: Context): String? = preferences(context).getString(KEY, null)

  fun write(context: Context, json: String): Boolean =
      preferences(context).edit().putString(KEY, json).commit()

  fun clear(context: Context): Boolean = preferences(context).edit().clear().commit()
}
