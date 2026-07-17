import { supabase } from '@/lib/supabase';
import type { BodyMeasurement, GoogleHealthConnection } from '@/types';

export interface GoogleHealthSyncResult {
  imported: number;
  syncedAt: string;
}

export async function startGoogleHealthConnect(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('google-health-oauth', {
    body: { action: 'start' },
  });
  if (error) throw new Error(`Could not start Google Health connection: ${error.message}`);
  const authorizeUrl = (data as { authorizeUrl?: string } | null)?.authorizeUrl;
  if (!authorizeUrl) throw new Error('Google Health returned no authorization URL.');
  return authorizeUrl;
}

export async function disconnectGoogleHealth(): Promise<void> {
  const { error } = await supabase.functions.invoke('google-health-oauth', {
    body: { action: 'disconnect' },
  });
  if (error) throw new Error(`Could not disconnect Google Health: ${error.message}`);
}

export async function syncGoogleHealth(): Promise<GoogleHealthSyncResult> {
  const { data, error } = await supabase.functions.invoke('google-health-sync', { body: {} });
  if (error) throw new Error(`Google Health sync failed: ${error.message}`);
  return data as GoogleHealthSyncResult;
}

export async function fetchGoogleHealthConnection(): Promise<GoogleHealthConnection | null> {
  const { data, error } = await supabase
    .from('google_health_connections')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data as GoogleHealthConnection | null;
}

export async function fetchLatestBodyMeasurement(): Promise<BodyMeasurement | null> {
  const { data, error } = await supabase
    .from('body_measurements')
    .select('*')
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as BodyMeasurement | null;
}

export function kgToPounds(weightKg: number): number {
  return weightKg * 2.2046226218;
}
