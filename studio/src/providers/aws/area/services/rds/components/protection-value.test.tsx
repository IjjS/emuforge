import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProtectionValue } from './protection-value';

describe('"Deletion protection"', () => {
  it('on → "On" and below it "Changed with {operation}." for the operation given', () => {
    for (const operation of ['ModifyDBInstance', 'ModifyDBCluster']) {
      const { unmount } = render(<ProtectionValue on operation={operation} />);
      expect(screen.getByText('On')).toBeInTheDocument();
      expect(screen.getByText(`Changed with ${operation}.`)).toBeInTheDocument();
      unmount();
    }
  });

  it('off → "Off" and no such sentence', () => {
    const { container } = render(<ProtectionValue on={false} operation="ModifyDBInstance" />);
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(container.textContent).not.toContain('Changed with');
  });
});
