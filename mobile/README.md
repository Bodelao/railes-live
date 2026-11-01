# RailES Live — app móvil

Hay dos formas de tener RailES Live en el móvil:

## 1. App web instalable (PWA): sin tiendas, inmediata

La web ya es una PWA (manifest, iconos, service worker y diseño móvil con navegación inferior).
Con el servidor publicado en HTTPS:

- **Android (Chrome):** abre la web → menú ⋮ → *Instalar aplicación* (o el botón «Instalar app»).
- **iPhone (Safari):** abre la web → Compartir → *Añadir a pantalla de inicio*.

## 2. App nativa Android / iOS (Capacitor)

Envuelve la web en una app nativa publicable en Google Play y App Store.

Requisitos: Node 20+, Android Studio (para Android) y Xcode en un Mac (para iOS).

1. Despliega el servidor de RailES Live con HTTPS y pon su URL en `capacitor.config.json` (`server.url`).
2. Instala las dependencias y crea los proyectos nativos:
   ```bash
   cd mobile
   npm install
   npx cap add android
   npx cap add ios
   ```
3. Abre el proyecto y compila:
   ```bash
   npx cap open android   # Android Studio → Build → Generate Signed Bundle / APK
   npx cap open ios       # Xcode → Product → Archive
   ```
4. Para el botón «Mi ubicación», añade el permiso de ubicación:
   - Android (`android/app/src/main/AndroidManifest.xml`): `<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />`
   - iOS (`ios/App/App/Info.plist`): `NSLocationWhenInUseUsageDescription` = «Para mostrar los trenes cerca de ti».

`www/index.html` es la pantalla que se muestra si el servidor no responde.
