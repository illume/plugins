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
  const commandRunner = vi.fn().mockResolvedValue({ stdout: 'arm-token', exitCode: 0 });
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          value: [{ subscriptionId: 'subscription', state: 'Enabled' }],
        }),
        { status: 200 }
      )
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              provider: 'grafana',
              name: 'dashboards',
              resourceGroup: 'operations',
              url: 'https://dashboards.example.azure.com',
            },
          ],
        }),
        { status: 200 }
      )
    );

  try {
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
  } finally {
    fetchSpy.mockRestore();
  }
});
