import { useMemo } from 'react';
import { View } from 'react-native';

import { programMuscleValue } from '@/lib/muscleProgress';
import { VOLUME_BAND_EDGES, programVolume, volumeRows, type VolumeProgramDay } from '@/lib/muscleVolume';

import { FormNote } from './Form';
import { Label } from './Label';
import { Hairline, Row } from './Row';

/**
 * A program's week, every day once: each muscle with its sets and, for a main
 * muscle, its band word. Read-only, for the editor's draft and a saved
 * program alike. Muscles the program never trains that are not main ones are
 * left out; a main muscle shows at 0.
 */
export function MuscleSetsList({ program }: { program: { days: readonly VolumeProgramDay[] } }) {
  const rows = useMemo(() => volumeRows(programVolume(program)), [program]);
  return (
    <>
      <Label style={{ overflow: 'hidden', marginTop: 12 }}>
        {rows.map((row, index) => (
          <View key={row.muscle}>
            {index > 0 ? <Hairline /> : null}
            <Row title={row.label} value={programMuscleValue(row)} accessibilityLabel={`${row.label}, ${spokenValue(row)}`} />
          </View>
        ))}
      </Label>
      <FormNote>
        {`Sets a week with every day done once. A set counts once for its main muscle and half for its second. Low is under ${VOLUME_BAND_EDGES.solidFrom}, solid ${VOLUME_BAND_EDGES.solidFrom} to ${VOLUME_BAND_EDGES.highAbove}, high above ${VOLUME_BAND_EDGES.highAbove}.`}
      </FormNote>
    </>
  );
}

/** "8.5 sets, solid" for VoiceOver. */
function spokenValue(row: { muscle: string; sets: number }): string {
  const [count, band] = programMuscleValue(row).split(' · ');
  return `${count} ${count === '1' ? 'set' : 'sets'}${band ? `, ${band}` : ''}`;
}
