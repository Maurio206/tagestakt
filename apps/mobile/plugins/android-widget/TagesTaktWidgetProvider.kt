// Generiert von apps/mobile/plugins/with-android-widget.js – nicht von Hand ändern.
package {{PACKAGE}}.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import {{PACKAGE}}.MainActivity
import {{PACKAGE}}.R

/**
 * Startbildschirm-Widget „Jetzt und danach“.
 *
 * Kein Netzwerk und keine eigene Datenquelle: Die App legt eine vorberechnete Zeitleiste ab
 * (TagesTaktWidgetModule), der Provider wählt per Zeitvergleich das passende Segment. Die
 * nächste Aktualisierung an der Segmentgrenze ist inexakt und weckt das Gerät nicht
 * (AlarmManager.setWindow mit RTC, ohne Exact-Alarm-Berechtigung); dazu kommen Systemereignisse
 * (Uhrzeit, Zeitzone, Neustart, App-Update) und der seltene Rückfall `updatePeriodMillis`.
 */
class TagesTaktWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    // IDs aus dem Intent werden nicht verwendet – nur die eigenen, gebundenen Widgets.
    refreshAll(context)
  }

  override fun onAppWidgetOptionsChanged(
      context: Context,
      manager: AppWidgetManager,
      appWidgetId: Int,
      newOptions: Bundle,
  ) {
    refreshAll(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    when (intent.action) {
      ACTION_REFRESH,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_TIMEZONE_CHANGED,
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED -> refreshAll(context)
    }
  }

  override fun onDisabled(context: Context) {
    cancelRefresh(context.applicationContext)
  }

  companion object {
    const val ACTION_REFRESH = "{{PACKAGE}}.widget.REFRESH"
    /** Öffnet TagesTakt in „Jetzt“ (Startroute). */
    private const val OPEN_URI = "tagestakt://"
    /** Gewünschtes Fenster; ab Android 12 dehnt das System es auf mindestens 10 Minuten. */
    private const val REFRESH_WINDOW_MS = 60_000L

    /** Alle Widgets neu zeichnen und die nächste Aktualisierung planen. */
    fun refreshAll(context: Context) {
      val app = context.applicationContext
      val manager = AppWidgetManager.getInstance(app)
      val ids = manager.getAppWidgetIds(ComponentName(app, TagesTaktWidgetProvider::class.java))
      if (ids.isEmpty()) {
        cancelRefresh(app)
        return
      }
      val state = WidgetPayload.resolve(WidgetStore.read(app), System.currentTimeMillis())
      manager.updateAppWidget(ids, render(app, state))
      when (state) {
        is WidgetPayload.State.Plan -> scheduleRefresh(app, state.until)
        is WidgetPayload.State.Empty -> scheduleRefresh(app, state.until)
        else -> cancelRefresh(app)
      }
    }

    private fun render(context: Context, state: WidgetPayload.State): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.tagestakt_widget)
      views.setOnClickPendingIntent(android.R.id.background, openAppIntent(context))
      if (state is WidgetPayload.State.Plan) {
        views.setViewVisibility(R.id.tagestakt_widget_plan, View.VISIBLE)
        views.setViewVisibility(R.id.tagestakt_widget_empty, View.GONE)
        val current = state.current
        views.setTextViewText(R.id.tagestakt_widget_meta, current.meta)
        views.setTextViewText(R.id.tagestakt_widget_title, current.title)
        if (current.free) {
          views.setInt(
              R.id.tagestakt_widget_card, "setBackgroundResource", R.drawable.tagestakt_widget_card_free)
          views.setViewVisibility(R.id.tagestakt_widget_bar, View.GONE)
          views.setTextColor(
              R.id.tagestakt_widget_title, context.getColor(R.color.tagestakt_widget_text_muted))
        } else {
          views.setInt(R.id.tagestakt_widget_card, "setBackgroundResource", card(current.tone))
          views.setViewVisibility(R.id.tagestakt_widget_bar, View.VISIBLE)
          views.setInt(R.id.tagestakt_widget_bar, "setColorFilter", toneColor(context, current.tone))
          views.setTextColor(
              R.id.tagestakt_widget_title, context.getColor(R.color.tagestakt_widget_text))
        }
        val next = state.next
        if (next != null) {
          views.setViewVisibility(R.id.tagestakt_widget_next_dot, View.VISIBLE)
          views.setInt(R.id.tagestakt_widget_next_dot, "setColorFilter", toneColor(context, next.tone))
          views.setViewVisibility(R.id.tagestakt_widget_next_time, View.VISIBLE)
          views.setTextViewText(R.id.tagestakt_widget_next_time, next.time)
          views.setTextViewText(R.id.tagestakt_widget_next_text, next.text)
        } else {
          views.setViewVisibility(R.id.tagestakt_widget_next_dot, View.GONE)
          views.setViewVisibility(R.id.tagestakt_widget_next_time, View.GONE)
          views.setTextViewText(
              R.id.tagestakt_widget_next_text,
              context.getString(R.string.tagestakt_widget_nothing_next))
        }
        views.setContentDescription(android.R.id.background, state.description)
      } else {
        val title =
            context.getString(
                when (state) {
                  is WidgetPayload.State.Empty -> R.string.tagestakt_widget_no_plan
                  WidgetPayload.State.Stale -> R.string.tagestakt_widget_stale
                  else -> R.string.tagestakt_widget_signed_out
                })
        views.setViewVisibility(R.id.tagestakt_widget_plan, View.GONE)
        views.setViewVisibility(R.id.tagestakt_widget_empty, View.VISIBLE)
        views.setTextViewText(R.id.tagestakt_widget_empty_title, title)
        views.setContentDescription(
            android.R.id.background,
            "$title. ${context.getString(R.string.tagestakt_widget_open)}.")
      }
      return views
    }

    private fun card(tone: String): Int =
        when (tone) {
          "business" -> R.drawable.tagestakt_widget_card_business
          "sport" -> R.drawable.tagestakt_widget_card_sport
          "relationship" -> R.drawable.tagestakt_widget_card_relationship
          "duty" -> R.drawable.tagestakt_widget_card_duty
          "violet" -> R.drawable.tagestakt_widget_card_violet
          else -> R.drawable.tagestakt_widget_card_neutral
        }

    private fun toneColor(context: Context, tone: String): Int =
        context.getColor(
            when (tone) {
              "business" -> R.color.tagestakt_widget_tone_business
              "sport" -> R.color.tagestakt_widget_tone_sport
              "relationship" -> R.color.tagestakt_widget_tone_relationship
              "duty" -> R.color.tagestakt_widget_tone_duty
              "violet" -> R.color.tagestakt_widget_tone_violet
              else -> R.color.tagestakt_widget_tone_neutral
            })

    private fun openAppIntent(context: Context): PendingIntent {
      val intent =
          Intent(Intent.ACTION_VIEW, Uri.parse(OPEN_URI), context, MainActivity::class.java)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      return PendingIntent.getActivity(
          context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun refreshIntent(context: Context, flags: Int): PendingIntent? {
      val intent = Intent(context, TagesTaktWidgetProvider::class.java).setAction(ACTION_REFRESH)
      return PendingIntent.getBroadcast(context, 0, intent, flags or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun scheduleRefresh(context: Context, at: Long) {
      val alarms = context.getSystemService(AlarmManager::class.java) ?: return
      val pending = refreshIntent(context, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
      // Inexakt und ohne Wecken: fällig, sobald das Gerät ohnehin wach ist (Bildschirm an).
      alarms.setWindow(AlarmManager.RTC, at, REFRESH_WINDOW_MS, pending)
    }

    private fun cancelRefresh(context: Context) {
      val alarms = context.getSystemService(AlarmManager::class.java) ?: return
      val pending = refreshIntent(context, PendingIntent.FLAG_NO_CREATE) ?: return
      alarms.cancel(pending)
      pending.cancel()
    }
  }
}
