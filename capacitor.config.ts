import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.hyper.mobile',
  appName: 'hyPer',
  webDir: 'dist',
  backgroundColor: '#F4F0E7',
  loggingBehavior: 'debug',
  ios: {
    allowsLinkPreview: false,
    contentInset: 'never',
    preferredContentMode: 'mobile',
  },
  server: {
    hostname: 'localhost',
    iosScheme: 'capacitor',
  },
}

export default config
