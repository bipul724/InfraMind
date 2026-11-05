import { useEffect, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Broken(): ReactNode {
  throw new Error('A page render failed');
}

function preventExpectedError(event: ErrorEvent) {
  if (event.message === 'A page render failed' || event.message === 'Navigation failed before the error screen appeared') {
    event.preventDefault();
  }
}

beforeEach(() => {
  // Suppress the deliberately thrown window errors so unexpected errors remain visible in test output.
  window.addEventListener('error', preventExpectedError);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  window.removeEventListener('error', preventExpectedError);
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('shows the error screen when a child throws', () => {
    render(<ErrorBoundary resetKey="/first"><Broken /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('clears an existing error when resetKey changes and renders the new child', () => {
    const view = render(<ErrorBoundary resetKey="/first"><Broken /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    view.rerender(<ErrorBoundary resetKey="/next"><p>Next page</p></ErrorBoundary>);

    expect(screen.getByText('Next page')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('does not remount a healthy child when resetKey changes', () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Healthy() {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <p>Healthy page</p>;
    }
    const view = render(<ErrorBoundary resetKey="/first"><Healthy /></ErrorBoundary>);

    view.rerender(<ErrorBoundary resetKey="/next"><Healthy /></ErrorBoundary>);

    expect(screen.getByText('Healthy page')).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it('keeps an error first thrown during a resetKey change on screen', () => {
    // The failure stops when the fallback mounts, so an unwanted automatic retry would hide the error.
    function TransientFailure() {
      if (!document.body.textContent?.includes('Something went wrong')) {
        throw new Error('Navigation failed before the error screen appeared');
      }
      return <p>Recovered without an explicit retry</p>;
    }
    const view = render(<ErrorBoundary resetKey="/first"><p>First page</p></ErrorBoundary>);

    view.rerender(<ErrorBoundary resetKey="/broken"><TransientFailure /></ErrorBoundary>);

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.queryByText('Recovered without an explicit retry')).toBeNull();
  });
});
