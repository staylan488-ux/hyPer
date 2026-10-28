import { TabStack } from '~/components/TabStack';

// A link straight to a You page (the Fuel widget opens you/targets when no
// target is set) still has You beneath it, so Back works. Expo Router's
// `anchor` (its old name, initialRouteName, now warns).
export const unstable_settings = { anchor: 'index' };

export default TabStack;
