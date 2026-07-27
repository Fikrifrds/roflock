import { useData } from '../lib/client.js';

export function ProviderModels({ providerId }: { providerId: string }) {
  const {
    data: models = [],
    isLoading,
    isError,
  } = useData<Array<{ id: string; displayName: string }>>(
    ['provider-models', providerId],
    `/api/providers/${providerId}/models`,
  );
  if (isLoading) return <p className="hint">Loading configured models…</p>;
  if (isError) return <p className="error">Configured models could not be loaded.</p>;
  return models.length ? (
    <p className="hint">
      Models: {models.map((model) => `${model.displayName} (${model.id})`).join(', ')}
    </p>
  ) : (
    <p className="hint">No models are configured for this provider.</p>
  );
}
