import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ObservabilitySettings } from './ObservabilitySettings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { provider?: string }) =>
      values?.provider ? key.replace('{{provider}}', values.provider) : key,
  }),
}));

it('edits native provider URLs and keeps credentials in password inputs', () => {
  const onChange = vi.fn();
  render(<ObservabilitySettings config={{}} onChange={onChange} />);

  fireEvent.change(screen.getByRole('textbox', { name: 'Grafana URL' }), {
    target: { value: 'https://grafana.example' },
  });
  expect(onChange).toHaveBeenCalledWith({
    grafana: { baseUrl: 'https://grafana.example' },
  });
  expect(screen.getByRole('group', { name: 'Grafana' })).toBeTruthy();
  expect(screen.getByLabelText('Service Account Token')).toHaveProperty('type', 'password');
  expect(screen.getByText(/require no MCP server/)).toBeTruthy();
});
