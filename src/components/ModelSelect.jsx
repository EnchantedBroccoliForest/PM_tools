import { useModels } from '../hooks/useModels';

export default function ModelSelect({ id, value, onChange, disabled, className }) {
  const modelGroups = useModels();
  const valueInList = modelGroups.some((g) => g.models.some((m) => m.id === value));

  return (
    <select id={id} value={value} onChange={onChange} disabled={disabled} className={className}>
      {/* If the current selection isn't in the live list (e.g. OpenRouter removed
          it since last launch), keep it visible so the user can switch away. */}
      {value && !valueInList && <option value={value}>{value}</option>}
      {modelGroups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
