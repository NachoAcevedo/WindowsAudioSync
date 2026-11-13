# WindowsAudioSync

Plugin privado para Vencord en Discord de escritorio y Windows 11. Sigue los dispositivos multimedia predeterminados de Windows. Usa los endpoints que devuelve Windows Core Audio y selecciona sus equivalentes en Discord.

1. Abrí **Ajustes de usuario → Vencord → Plugins** y buscá **WindowsAudioSync**.
2. Activá el plugin y abrí su engranaje. **Follow the Windows default microphone** controla la entrada y **Follow the Windows default speakers or headphones** controla la salida. Ambos vienen activados.
3. Cambiá la entrada y la salida por separado en **Configuración → Sistema → Sonido** de Windows. Revisá la selección de Discord en **Voz y video**. Para confirmar la independencia de los controles, desactivá uno y repetí ambos cambios.

Al apagar un control, Discord conserva la última selección de ese dispositivo y podés volver a elegirlo manualmente.

## Compilar

Copiá esta carpeta como `src/userplugins/WindowsAudioSync` en el código fuente de Vencord y ejecutá `pnpm build --dev --disable-updater`. El parámetro `--disable-updater` evita que Vencord reemplace la compilación privada con una actualización automática. Para incorporar una versión nueva de Vencord, recompilá el plugin con esa versión.

[Guía de plugins personalizados de Vencord](https://docs.vencord.dev/installing/custom-plugins/)
