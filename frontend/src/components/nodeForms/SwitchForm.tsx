import { X } from 'lucide-react';
import VariableInput, { type AvailableVariable } from '../VariableInput';
import VariableFieldSelect from './VariableFieldSelect';

type SwitchFormProps = {
  value: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  availableVariables: AvailableVariable[];
  disabled?: boolean;
};

export default function SwitchForm({
  value: config,
  onChange,
  availableVariables,
  disabled,
}: SwitchFormProps) {
  const cases = (config.cases as Array<any>) || [];

  const addCase = () => {
    const newCases = [
      ...cases,
      { id: `case_${Date.now()}`, operator: 'equals', value: '' },
    ];
    onChange({ cases: newCases });
  };

  const updateCase = (idx: number, field: string, val: string) => {
    const newCases = [...cases];
    newCases[idx] = { ...newCases[idx], [field]: val };
    onChange({ cases: newCases });
  };

  const removeCase = (idx: number) => {
    const newCases = cases.filter((_: any, i: number) => i !== idx);
    onChange({ cases: newCases });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Pole do sprawdzenia
        </label>
        <VariableFieldSelect
          placeholder="Wybierz pole z danych…"
          className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
          value={String(config.variable || '')}
          onChange={(next) => onChange({ variable: next })}
          availableVariables={availableVariables}
          disabled={disabled}
          allowFreeText
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Najczęściej to pole z poprzedniego kroku (wybierz z listy).
        </p>
      </div>

      <div className="space-y-3 mt-2">
        <label className="text-sm font-medium text-foreground">Ścieżki i warunki</label>
        {cases.map((c: any, idx: number) => (
          <div
            key={c.id}
            className="p-3 border border-border rounded-md bg-white space-y-2 relative shadow-sm"
          >
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-semibold text-primary">Wyjście: {c.id}</span>
              <button
                type="button"
                onClick={() => removeCase(idx)}
                className="text-red-500 hover:text-red-700 bg-red-50 p-1 rounded transition-colors shrink-0"
                disabled={disabled}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <select
              className="w-full text-xs border-border rounded-md shadow-sm border p-2 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
              value={c.operator || 'equals'}
              onChange={(e) => updateCase(idx, 'operator', e.target.value)}
              disabled={disabled}
            >
              <option value="equals">Jest równe dokładnie</option>
              <option value="greater">Jest większe niż</option>
              <option value="less">Jest mniejsze niż</option>
              <option value="contains">Zawiera tekst</option>
            </select>
            <VariableInput
              placeholder="Wartość (np. 100 lub 'Opłacone')"
              className="w-full text-xs border-border rounded-md shadow-sm p-2 border focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={c.value || ''}
              onChange={(next) => updateCase(idx, 'value', next)}
              availableVariables={availableVariables}
              disabled={disabled}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addCase}
          disabled={disabled}
          className="w-full py-2 text-xs font-medium text-primary border border-primary/30 rounded-md hover:bg-primary/5 transition-colors disabled:opacity-50"
        >
          + Dodaj warunek
        </button>
        <div className="p-3 bg-muted/50 rounded-lg border border-border">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Zawsze aktywne jest również wyjście{' '}
            <span className="font-semibold text-foreground">default</span>, którym polecą
            dane, jeśli żaden z warunków nie zostanie spełniony.
          </p>
        </div>
      </div>
    </div>
  );
}

