import { describe, expect, it } from 'vitest';

import { parseLocator } from './locators.js';

describe('browser locator grammar', () => {
  it('parses semantic locators and preserves CSS fallbacks', () => {
    expect(parseLocator(' role= Button[name="Sign in"] ')).toEqual({ strategy: 'role', role: 'button', name: 'Sign in' });
    expect(parseLocator("role=link[name='Go next']")).toEqual({ strategy: 'role', role: 'link', name: 'Go next' });
    expect(parseLocator('role=alert')).toEqual({ strategy: 'role', role: 'alert' });
    expect(parseLocator('text="Go next"')).toEqual({ strategy: 'text', text: 'Go next' });
    expect(parseLocator('data-testid=email-field')).toEqual({ strategy: 'testid', testId: 'email-field' });
    expect(parseLocator('testid=email-field')).toEqual({ strategy: 'testid', testId: 'email-field' });
    expect(parseLocator('css=.cta')).toEqual({ strategy: 'css', selector: 'css=.cta' });
    expect(parseLocator(' .cta ')).toEqual({ strategy: 'css', selector: '.cta' });
    expect(parseLocator('role=bad role')).toEqual({ strategy: 'role', role: 'bad role' });
  });
});
