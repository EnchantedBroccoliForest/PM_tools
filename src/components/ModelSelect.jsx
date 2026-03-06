import { MODEL_GROUPS } from '../constants/models';

export default function ModelSelect({ id, value, onChange, disabled, className }) {
  return (
    <select id={id} value={value} onChange={onChange} disabled={disabled} className={className}>
      {MODEL_GROUPS.map((group) => (
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
