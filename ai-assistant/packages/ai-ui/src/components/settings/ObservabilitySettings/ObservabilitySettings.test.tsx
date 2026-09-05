import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ObservabilitySettings } from './ObservabilitySettings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { provider?: string }) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, value),
        key
      ),
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
  fireEvent.click(screen.getByRole('button', { name: 'Use http://localhost:9090' }));
  expect(onChange).toHaveBeenCalledWith({
    prometheus: { baseUrl: 'http://localhost:9090' },
  });
  expect(screen.getByLabelText('Service Account Token')).toHaveProperty('type', 'password');
  expect(screen.getByText(/require no MCP server/)).toBeTruthy();
});

it('discovers Azure endpoints and only applies the selected result', async () => {
  const onChange = vi.fn();
  const commandRunner = vi
    .fn()
    .mockResolvedValueOnce({ stdout: '{}', exitCode: 0 })
    .mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          name: 'dashboards',
          resourceGroup: 'operations',
          properties: { endpoint: 'https://dashboards.example.azure.com' },
        },
      ]),
      exitCode: 0,
    })
    .mockResolvedValueOnce({ stdout: '[]', exitCode: 0 });
  render(<ObservabilitySettings config={{}} onChange={onChange} commandRunner={commandRunner} />);

  fireEvent.click(screen.getByRole('button', { name: 'Discover from Azure CLI' }));
  const result = await screen.findByRole('button', {
    name: 'Use dashboards (operations) for Grafana',
  });
  expect(onChange).not.toHaveBeenCalled();

  fireEvent.click(result);
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith({
      grafana: { baseUrl: 'https://dashboards.example.azure.com' },
    })
  );
});
