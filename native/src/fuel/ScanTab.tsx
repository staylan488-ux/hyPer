import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';

import { lookupBarcode } from '@/lib/barcodeLookup';
import {
  BARCODE_AVAILABILITY_TIMEOUT_MS,
  BARCODE_LOOKUP_TIMEOUT_MS,
  BARCODE_MESSAGES,
  BARCODE_SCAN_TIMEOUT_MS,
  normalizeBarcode,
  normalizeFoodBarcode,
} from '@/lib/barcodes';
import { createRequestGate } from '@/lib/requestGate';
import { withTimeout } from '@/lib/withTimeout';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow } from '~/components/Form';
import { Label } from '~/components/Label';
import { haptics } from '~/lib/haptics';
import { space } from '~/theme/blanc';

import { HyperBarcode } from '../../modules/hyper-barcode';
import { useLogger } from './context';

type ScanState = 'starting' | 'idle' | 'looking-up' | 'error';

/**
 * Scan: Scan barcode opens VisionKit's scanner (the camera never opens just
 * because the tab did; the owner asked for that on 2026-10-27); digits can be
 * typed instead. A miss offers to create the product.
 */
export function ScanTab({ onCreateProduct }: { onCreateProduct: (barcode: string | null) => void }) {
  const logger = useLogger();
  const [state, setState] = useState<ScanState>('idle');
  const [message, setMessage] = useState('Scan a barcode or enter its digits.');
  const [available, setAvailable] = useState(true);
  const [digits, setDigits] = useState('');
  const [missed, setMissed] = useState<string | null>(null);
  // a newer scan, or leaving Scan, drops a late result
  const [gate] = useState(createRequestGate);
  const { setBusy, chooseFood } = logger;
  useEffect(() => () => gate.invalidate(), [gate]);

  const resolve = useCallback(
    async (rawValue: string, format?: string) => {
      const barcode = normalizeFoodBarcode(rawValue, format);
      if (!barcode) {
        setState('error');
        setMessage(BARCODE_MESSAGES.invalid);
        return;
      }
      haptics.tap();
      setMissed(null);
      setState('looking-up');
      setMessage(`Looking up ${barcode}…`);
      const isCurrent = gate.begin();
      setBusy(true);
      try {
        const result = await withTimeout(lookupBarcode(barcode, isCurrent), BARCODE_LOOKUP_TIMEOUT_MS, BARCODE_MESSAGES.timeout);
        if (!isCurrent() || result.status === 'stale') return;
        if (result.status === 'miss') {
          haptics.error();
          setMissed(barcode);
          setState('error');
          setMessage(BARCODE_MESSAGES.miss);
          return;
        }
        setState('idle');
        setMessage(BARCODE_MESSAGES.found);
        chooseFood(result.food, { source: 'barcode', barcode, provider: result.provider });
      } catch (error) {
        if (!isCurrent()) return;
        setState('error');
        setMessage(error instanceof Error ? error.message : BARCODE_MESSAGES.failed);
      } finally {
        setBusy(false);
      }
    },
    [chooseFood, gate, setBusy],
  );

  const scan = useCallback(async () => {
    setState('starting');
    setMessage('Opening the camera…');
    try {
      const { available: ok } = await withTimeout(
        HyperBarcode.getAvailability(),
        BARCODE_AVAILABILITY_TIMEOUT_MS,
        'The camera did not respond.',
      );
      if (!ok) {
        setAvailable(false);
        setState('idle');
        setMessage('Barcode scanning is not available on this device. Enter the digits below.');
        return;
      }
      const scanned = await withTimeout(HyperBarcode.scanBarcode(), BARCODE_SCAN_TIMEOUT_MS, 'The scan timed out.');
      await resolve(scanned.rawValue, scanned.format);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'CANCELLED') {
        setState('idle');
        setMessage('Scan a barcode or enter its digits.');
        return;
      }
      setState('error');
      setMessage(
        code === 'SCAN_FAILED'
          ? 'The camera stopped. If camera access is off, allow it for hyPer in Settings, then scan again.'
          : error instanceof Error
            ? error.message
            : 'Could not start the scanner.',
      );
    }
  }, [resolve]);

  // Whether this phone can scan at all, asked without opening the camera.
  useEffect(() => {
    let current = true;
    void withTimeout(HyperBarcode.getAvailability(), BARCODE_AVAILABILITY_TIMEOUT_MS, 'The camera did not respond.')
      .then(({ available: ok }) => {
        if (!current || ok) return;
        setAvailable(false);
        setMessage('Barcode scanning is not available on this device. Enter the digits below.');
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  const typed = normalizeBarcode(digits);
  const typedValid = Boolean(normalizeFoodBarcode(typed));
  const busy = state === 'starting' || state === 'looking-up';

  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ paddingHorizontal: space.gutter, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 24 }}>
        {busy ? <ActivityIndicator size="small" /> : null}
        <BlancText variant="secondary" tone={state === 'error' ? 'live' : 'graphite'} style={{ flex: 1 }} accessibilityLiveRegion="polite">
          {message}
        </BlancText>
      </View>

      {available ? (
        <View style={{ paddingHorizontal: space.gutter, marginTop: 16 }}>
          <Capsule
            title={state === 'idle' && message === BARCODE_MESSAGES.found ? 'Scan again' : 'Scan barcode'}
            size="large"
            fill
            onPress={() => void scan()}
            disabled={busy}
          />
        </View>
      ) : null}

      {missed ? (
        <View style={{ paddingHorizontal: space.gutter, marginTop: 18, gap: 12 }}>
          <BlancText variant="secondary">
            {logger.purpose === 'ingredients'
              ? `No catalog match for barcode ${missed}. Enter the package nutrition to add this ingredient.`
              : `No catalog match for barcode ${missed}. Enter it from the package label once and it will be yours on every future scan.`}
          </BlancText>
          <Capsule
            title={logger.purpose === 'ingredients' ? 'Enter ingredient manually' : 'Create a saved product'}
            variant="quiet"
            onPress={() => onCreateProduct(logger.purpose === 'ingredients' ? null : missed)}
          />
        </View>
      ) : null}

      <View style={{ marginTop: 26 }}>
        <Label>
          <FieldRow
            label="Barcode digits"
            value={digits}
            onChangeText={(text) => setDigits(text.replace(/\D/g, '').slice(0, 14))}
            keyboardType="number-pad"
            placeholder="0 41570 05416 1"
            returnKeyType="search"
            onSubmitEditing={() => typedValid && void resolve(typed)}
          />
        </Label>
        <View style={{ paddingHorizontal: space.gutter, marginTop: 12 }}>
          <Capsule title="Look up barcode" variant="quiet" disabled={!typedValid || busy} onPress={() => void resolve(typed)} />
        </View>
      </View>

      <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 24 }}>
        Product fallback data from{' '}
        <BlancText variant="footnote" style={{ textDecorationLine: 'underline' }} onPress={() => void Linking.openURL('https://world.openfoodfacts.org/')}>
          Open Food Facts
        </BlancText>{' '}
        under the{' '}
        <BlancText
          variant="footnote"
          style={{ textDecorationLine: 'underline' }}
          onPress={() => void Linking.openURL('https://world.openfoodfacts.org/terms-of-use')}>
          ODbL
        </BlancText>
        .
      </BlancText>
    </View>
  );
}
