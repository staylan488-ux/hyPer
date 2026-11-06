import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';

export type PickedPhoto = { uri: string; width: number; height: number };

/** Said when camera access is refused (both analysis tabs). */
export const CAMERA_OFF = 'Camera access is off. Allow Camera for hyPer in Settings, then try again.';
/** The simulator has no camera. */
export const CAMERA_UNAVAILABLE = 'The camera isn’t available here.';

/** How the camera screen ended: a photo, nothing (closed), or why it could not take one. */
export type CameraOutcome = { photo: PickedPhoto | null } | { error: string };

let waiting: ((outcome: CameraOutcome) => void) | null = null;

/**
 * Opens the camera screen (`app/food-camera.tsx`), whose photo library button
 * picks an existing photo instead. Settles once the screen has gone: with the
 * photo, null when closed, or an error when the camera could not be used.
 */
export function openFoodCamera(): Promise<PickedPhoto | null> {
  // never two waiting at once (pickFoodPhoto allows one picker); an older one is let go
  waiting?.({ photo: null });
  return new Promise((resolve, reject) => {
    waiting = (outcome) => ('error' in outcome ? reject(new Error(outcome.error)) : resolve(outcome.photo));
    router.push('/food-camera');
  });
}

/** The camera screen's answer as it goes; later answers do nothing. */
export function settleFoodCamera(outcome: CameraOutcome): void {
  const settle = waiting;
  waiting = null;
  settle?.(outcome);
}

/** iOS's photo picker (it needs no photo-library permission). Null when cancelled. */
export async function choosePhotoFromLibrary(): Promise<PickedPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  if (asset.type && asset.type !== 'image') throw new Error('Please choose an image file.');
  return { uri: asset.uri, width: asset.width, height: asset.height };
}
