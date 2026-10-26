import {environment as baseEnvironment} from './environment.local-isolated';

// the isolated Firebase stack pairs with the user's ordinary local GIO on
// 8080 instead of the test-owned 8180 instance - only the GIO origin differs
export const environment = {
  ...baseEnvironment,
  localServices: {
    ...baseEnvironment.localServices,
    gioUrl: 'http://localhost:8080',
  },
};
