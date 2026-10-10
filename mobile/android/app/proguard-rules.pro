# ---------------------------------------------------------------------------
# Farah Water Company - ProGuard/R8 rules for the release build.
# ---------------------------------------------------------------------------

# React Native core
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.common.internal.DoNotStrip *;
    @com.facebook.proguard.annotations.KeepGettersAndSetters *;
}
-keep class * extends com.facebook.react.bridge.JavaScriptModule { *; }
-keep class * extends com.facebook.react.bridge.NativeModule { *; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactProp <methods>; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>; }
-dontwarn com.facebook.react.**
-keep,includedescriptorclasses class com.facebook.react.bridge.** { *; }

# Hermes
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# @react-native-async-storage
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# NetInfo
-keep class com.reactnativecommunity.netinfo.** { *; }

# Keychain (Android Keystore bridge)
-keep class com.oblador.keychain.** { *; }

# react-native-screens / safe-area-context
-keep class com.swmansion.rnscreens.** { *; }
-keep class com.swmansion.safearea.** { *; }

# Vector icons
-keep class com.oblador.vectoricons.** { *; }

# Play Core is referenced by react-native; harmless if unused.
-dontwarn com.google.android.play.core.**
