import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { Button } from './Button';
import { Screen } from './Screen';

/**
 * Shown in place of a page that threw while rendering. It sits inside the app
 * shell, so the bottom nav still works and switching tabs clears the error.
 * Keep it plain: no store reads or heavy imports that could fail again.
 */
export function RouteErrorScreen() {
  const error = useRouteError();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Screen>
      <header className="mb-7">
        <p className="t-label-sm mb-2">Something went wrong</p>
        <h1 className="t-title">This page couldn't load</h1>
        <p className="t-caption mt-3">Try loading it again, or head back to Today.</p>
      </header>
      <div className="flex flex-col gap-3">
        {/* A full load of a known-good page avoids looping on the broken route. */}
        <Button onClick={() => window.location.assign('/')}>Go to Today</Button>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    </Screen>
  );
}
