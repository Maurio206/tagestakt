// Generiert von apps/mobile/plugins/with-android-widget.js – nicht von Hand ändern.
package {{PACKAGE}}.widget

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registriert TagesTaktWidgetModule (in MainApplication eingetragen, keine Fremdbibliothek). */
class TagesTaktWidgetPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == TagesTaktWidgetModule.NAME) TagesTaktWidgetModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
        TagesTaktWidgetModule.NAME to
            ReactModuleInfo(
                TagesTaktWidgetModule.NAME,
                TagesTaktWidgetModule::class.java.name,
                false, // canOverrideExistingModule
                false, // needsEagerInit
                false, // isCxxModule
                false, // isTurboModule (klassisches Modul über die Interop-Schicht)
            ))
  }
}
