import { useCallback, useEffect, useState } from 'react';
import { Blocks, GitCompareArrows, Plus, Trash2 } from 'lucide-react';
import VariableInput, { type AvailableVariable } from '../VariableInput';
import VariableFieldSelect from './VariableFieldSelect';

type RuleGroupCondition = 'AND' | 'OR';
type RuleOperator =
  | 'equals'
  | 'not_equals'
  | 'greater'
  | 'greater_or_equal'
  | 'less'
  | 'less_or_equal'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty';
type RuleValueType = 'auto' | 'string' | 'number' | 'boolean' | 'date';

interface IfElseRule {
  id: string;
  field: string;
  operator: RuleOperator;
  value: string;
  value_type: RuleValueType;
}

interface IfElseRuleGroup {
  id: string;
  condition: RuleGroupCondition;
  rules: Array<IfElseRule | IfElseRuleGroup>;
}

type IfElseFormProps = {
  value: unknown;
  onChange: (nextValue: IfElseRuleGroup) => void;
  availableVariables: AvailableVariable[];
  disabled?: boolean;
};

const RULE_OPERATOR_OPTIONS: Array<{ value: RuleOperator; label: string }> = [
  { value: 'equals', label: 'Jest równe' },
  { value: 'not_equals', label: 'Nie jest równe' },
  { value: 'greater', label: 'Jest większe niż' },
  { value: 'greater_or_equal', label: 'Jest większe lub równe' },
  { value: 'less', label: 'Jest mniejsze niż' },
  { value: 'less_or_equal', label: 'Jest mniejsze lub równe' },
  { value: 'contains', label: 'Zawiera' },
  { value: 'not_contains', label: 'Nie zawiera' },
  { value: 'starts_with', label: 'Zaczyna się od' },
  { value: 'ends_with', label: 'Kończy się na' },
  { value: 'is_empty', label: 'Jest puste' },
  { value: 'is_not_empty', label: 'Nie jest puste' },
];

const buildAstId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const createEmptyRule = (): IfElseRule => ({
  id: buildAstId('rule'),
  field: '',
  operator: 'equals',
  value: '',
  value_type: 'auto',
});

const createEmptyRuleGroup = (): IfElseRuleGroup => ({
  id: buildAstId('group'),
  condition: 'AND',
  rules: [createEmptyRule()],
});

const isRuleOperator = (value: unknown): value is RuleOperator =>
  typeof value === 'string' &&
  RULE_OPERATOR_OPTIONS.some((option) => option.value === value);

const isRuleValueType = (value: unknown): value is RuleValueType =>
  value === 'auto' ||
  value === 'string' ||
  value === 'number' ||
  value === 'boolean' ||
  value === 'date';

const isGroupCondition = (value: unknown): value is RuleGroupCondition =>
  value === 'AND' || value === 'OR';

const normalizeIfElseRuleTree = (value: unknown): IfElseRuleGroup => {
  const sanitizeNode = (nodeValue: unknown): IfElseRule | IfElseRuleGroup | null => {
    if (!nodeValue || typeof nodeValue !== 'object') return null;
    const node = nodeValue as Record<string, unknown>;

    if (Array.isArray(node.rules)) {
      const condition = isGroupCondition(node.condition) ? node.condition : 'AND';
      const normalizedRules = node.rules
        .map((child) => sanitizeNode(child))
        .filter((child): child is IfElseRule | IfElseRuleGroup => Boolean(child));

      return {
        id: typeof node.id === 'string' ? node.id : buildAstId('group'),
        condition,
        rules: normalizedRules.length ? normalizedRules : [createEmptyRule()],
      };
    }

    const field = typeof node.field === 'string' ? node.field : '';
    const operator = isRuleOperator(node.operator) ? node.operator : 'equals';
    const valueAsString =
      typeof node.value === 'string'
        ? node.value
        : node.value == null
          ? ''
          : String(node.value);
    const valueType = isRuleValueType(node.value_type) ? node.value_type : 'auto';

    return {
      id: typeof node.id === 'string' ? node.id : buildAstId('rule'),
      field,
      operator,
      value: valueAsString,
      value_type: valueType,
    };
  };

  const normalized = sanitizeNode(value);
  if (normalized && 'condition' in normalized && Array.isArray(normalized.rules)) {
    return normalized;
  }

  if (value && typeof value === 'object') {
    const legacy = value as Record<string, unknown>;
    const variable = typeof legacy.variable === 'string' ? legacy.variable : '';
    const operator = isRuleOperator(legacy.operator) ? legacy.operator : 'equals';
    const targetValue =
      typeof legacy.value === 'string'
        ? legacy.value
        : legacy.value == null
          ? ''
          : String(legacy.value);

    if (variable || targetValue) {
      return {
        id: buildAstId('group'),
        condition: 'AND',
        rules: [
          {
            id: buildAstId('rule'),
            field: variable,
            operator,
            value: targetValue,
            value_type: 'auto',
          },
        ],
      };
    }
  }

  return createEmptyRuleGroup();
};

export default function IfElseForm({
  value,
  onChange,
  availableVariables,
  disabled,
}: IfElseFormProps) {
  const [ast, setAst] = useState<IfElseRuleGroup>(() => normalizeIfElseRuleTree(value));

  useEffect(() => {
    setAst(normalizeIfElseRuleTree(value));
  }, [value]);

  const commit = useCallback(
    (nextAst: IfElseRuleGroup) => {
      setAst(nextAst);
      onChange(nextAst);
    },
    [onChange]
  );

  const updateNodeInTree = useCallback(
    (
      node: IfElseRule | IfElseRuleGroup,
      nodeId: string,
      updater: (current: IfElseRule | IfElseRuleGroup) => IfElseRule | IfElseRuleGroup
    ): IfElseRule | IfElseRuleGroup => {
      if (node.id === nodeId) {
        return updater(node);
      }

      if ('rules' in node) {
        return {
          ...node,
          rules: node.rules.map((child) => updateNodeInTree(child, nodeId, updater)),
        };
      }

      return node;
    },
    []
  );

  const removeNodeInTree = useCallback((group: IfElseRuleGroup, nodeId: string) => {
    const prune = (node: IfElseRule | IfElseRuleGroup): IfElseRule | IfElseRuleGroup | null => {
      if (node.id === nodeId) return null;
      if ('rules' in node) {
        const nestedRules = node.rules
          .map((child) => prune(child))
          .filter((child): child is IfElseRule | IfElseRuleGroup => Boolean(child));
        return { ...node, rules: nestedRules };
      }
      return node;
    };

    const cleaned = prune(group);
    if (!cleaned || !('rules' in cleaned)) {
      return createEmptyRuleGroup();
    }

    return {
      ...cleaned,
      rules: cleaned.rules.length ? cleaned.rules : [createEmptyRule()],
    };
  }, []);

  const updateRule = (ruleId: string, patch: Partial<IfElseRule>) => {
    const next = updateNodeInTree(ast, ruleId, (node) => {
      if (!('field' in node)) return node;
      return { ...node, ...patch };
    }) as IfElseRuleGroup;
    commit(next);
  };

  const updateGroupCondition = (groupId: string, condition: RuleGroupCondition) => {
    const next = updateNodeInTree(ast, groupId, (node) => {
      if (!('rules' in node)) return node;
      return { ...node, condition };
    }) as IfElseRuleGroup;
    commit(next);
  };

  const addRuleToGroup = (groupId: string) => {
    const next = updateNodeInTree(ast, groupId, (node) => {
      if (!('rules' in node)) return node;
      return { ...node, rules: [...node.rules, createEmptyRule()] };
    }) as IfElseRuleGroup;
    commit(next);
  };

  const addGroupToGroup = (groupId: string) => {
    const next = updateNodeInTree(ast, groupId, (node) => {
      if (!('rules' in node)) return node;
      return { ...node, rules: [...node.rules, createEmptyRuleGroup()] };
    }) as IfElseRuleGroup;
    commit(next);
  };

  const removeNode = (nodeId: string) => {
    if (nodeId === ast.id) return;
    commit(removeNodeInTree(ast, nodeId));
  };

  const renderRule = (rule: IfElseRule, depth: number) => {
    const shouldHideValueInput = rule.operator === 'is_empty' || rule.operator === 'is_not_empty';
    return (
      <div
        key={rule.id}
        className="space-y-2 rounded-lg border border-border bg-white p-3 shadow-sm"
        style={{ marginLeft: `${depth * 8}px` }}
      >
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Reguła
          </p>
          <button
            type="button"
            onClick={() => removeNode(rule.id)}
            disabled={disabled}
            className="p-1 rounded text-red-500 hover:bg-red-50 disabled:opacity-50"
            title="Usuń regułę"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <VariableFieldSelect
          placeholder="Wybierz pole z danych…"
          className="w-full text-xs border-border rounded-md border p-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          value={rule.field}
          onChange={(next) => updateRule(rule.id, { field: next })}
          availableVariables={availableVariables}
          disabled={disabled}
          allowFreeText
        />
        <p className="text-[10px] text-muted-foreground">
          Podpowiedź: wybierz pole z listy albo wpisz własną ścieżkę.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <select
            className="w-full text-xs border-border rounded-md border p-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            value={rule.operator}
            onChange={(e) => updateRule(rule.id, { operator: e.target.value as RuleOperator })}
            disabled={disabled}
          >
            {RULE_OPERATOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="w-full text-xs border-border rounded-md border p-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            value={rule.value_type}
            onChange={(e) => updateRule(rule.id, { value_type: e.target.value as RuleValueType })}
            disabled={disabled}
          >
            <option value="auto">Typ: Auto</option>
            <option value="string">Typ: Tekst</option>
            <option value="number">Typ: Liczba</option>
            <option value="boolean">Typ: Boolean</option>
            <option value="date">Typ: Data</option>
          </select>
        </div>

        {!shouldHideValueInput && (
          <VariableInput
            placeholder="Wartość porównania"
            className="w-full text-xs border-border rounded-md border p-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={rule.value}
            onChange={(next) => updateRule(rule.id, { value: next })}
            availableVariables={availableVariables}
            disabled={disabled}
          />
        )}
      </div>
    );
  };

  const renderGroup = (group: IfElseRuleGroup, depth = 0, isRoot = false) => {
    return (
      <div
        key={group.id}
        className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-3"
        style={{ marginLeft: `${depth * 8}px` }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Blocks className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isRoot ? 'Grupa główna' : 'Grupa'}
            </span>
          </div>
          {!isRoot && (
            <button
              type="button"
              onClick={() => removeNode(group.id)}
              disabled={disabled}
              className="p-1 rounded text-red-500 hover:bg-red-50 disabled:opacity-50"
              title="Usuń grupę"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <GitCompareArrows className="w-3.5 h-3.5 text-muted-foreground" />
          <select
            className="text-xs border-border rounded-md border p-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            value={group.condition}
            onChange={(e) => updateGroupCondition(group.id, e.target.value as RuleGroupCondition)}
            disabled={disabled}
          >
            <option value="AND">Wszystkie (AND)</option>
            <option value="OR">Dowolna (OR)</option>
          </select>
        </div>

        <div className="space-y-2">
          {group.rules.map((node) =>
            'rules' in node ? renderGroup(node, depth + 1) : renderRule(node, depth + 1)
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => addRuleToGroup(group.id)}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1.5 text-[11px] text-foreground hover:bg-muted disabled:opacity-50"
          >
            <Plus className="w-3 h-3" />
            Dodaj regułę
          </button>
          <button
            type="button"
            onClick={() => addGroupToGroup(group.id)}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1.5 text-[11px] text-foreground hover:bg-muted disabled:opacity-50"
          >
            <Plus className="w-3 h-3" />
            Dodaj grupę
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-md border border-primary/20 bg-primary/5">
        <p className="text-xs text-muted-foreground">
          Buduj warunki jako drzewo reguł. Każda grupa może używać operatora <b>AND</b> lub{' '}
          <b>OR</b>.
        </p>
      </div>
      {renderGroup(ast, 0, true)}
    </div>
  );
}

