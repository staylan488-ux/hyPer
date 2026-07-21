import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.hyper.mobile',
  appName: 'hyPer',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      // Foreground completion is announced by the in-app chime + haptic;
      // the scheduled banner is only for the backgrounded/locked case.
      presentationOptions: []
    }
  }
};

export default config;
