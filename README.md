# WindowsAudioSync

Plugin privado para Vencord en Discord de escritorio y Windows 11. Sigue los dispositivos multimedia predeterminados de Windows. Usa los endpoints que devuelve Windows Core Audio y selecciona sus equivalentes en Discord.

1. Abrí **Ajustes de usuario → Vencord → Plugins** y buscá **WindowsAudioSync**.
2. Activá el plugin y abrí su engranaje. El control del micrófono sincroniza el dispositivo y su estado de silencio. El control de salida sincroniza el dispositivo y ensordece Discord si Windows silencia la salida o si su volumen llega a cero. Ambos vienen activados.
3. Cambiá la entrada y la salida por separado en **Configuración → Sistema → Sonido** de Windows. Revisá la selección de Discord en **Voz y video**. Para confirmar la independencia de los controles, desactivá uno y repetí ambos cambios.

Al apagar un control, Discord conserva la última selección de ese dispositivo y podés volver a elegirlo manualmente.

Cuando vuelve el audio, el plugin revierte los silencios que activó durante esa sesión. Un interruptor físico que solo corta la señal del micrófono requiere que el dispositivo también informe su estado de silencio a Windows.

## Compilar

Copiá esta carpeta como `src/userplugins/WindowsAudioSync` en el código fuente de Vencord y ejecutá `pnpm build --dev --disable-updater`. El parámetro `--disable-updater` evita que Vencord reemplace la compilación privada con una actualización automática. Para incorporar una versión nueva de Vencord, recompilá el plugin con esa versión.

[Guía de plugins personalizados de Vencord](https://docs.vencord.dev/installing/custom-plugins/)
