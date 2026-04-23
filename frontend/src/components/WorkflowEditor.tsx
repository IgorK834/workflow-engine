import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Save,
  Play,
  Upload,
  ArrowLeft,
  Webhook,
  GitBranch,
  MessageSquare,
  Database,
  Settings2,
  X,
  Globe,
  Mail,
  Clock,
  FileJson,
  Copy,
  Trello,
  CheckCircle,
  Sparkles,
  Brain,
  Zap,
  Variable,
  Braces,
  ChevronRight,
  Plus,
  Trash2,
  GitCompareArrows,
  Blocks,
} from 'lucide-react';
import TriggerNode from '../nodes/TriggerNode';
import LogicNode from '../nodes/LogicNode';
import ActionNode from '../nodes/ActionNode';
import {
  createWorkflow,
  executeWorkflowTest,
  publishWorkflow,
  testWorkflowNode,
} from '../api/workflows';
import { useWorkflows } from '../hooks/useWorkflows';
import { listCollections, type CollectionSummary } from '../api/collections';

const nodeTypes = {
  trigger: TriggerNode,
  logic: LogicNode,
  action: ActionNode,
};

let id = 0;
const getId = () => `node_${id++}`;

interface WorkflowEditorProps {
  onBack: () => void;
  workflowId?: string | null;
}

type SchemaLeafType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';
interface OutputSchema {
  [key: string]: SchemaLeafType | OutputSchema;
}

interface AvailableNodeSchema {
  nodeId: string;
  nodeLabel: string;
  schema: OutputSchema;
}

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

interface IfElseRuleBuilderProps {
  value: unknown;
  onChange: (nextValue: IfElseRuleGroup) => void;
  availableSchemas: AvailableNodeSchema[];
  disabled?: boolean;
}

interface VariablePickerInputProps {
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  availableSchemas: AvailableNodeSchema[];
}

const TEMPLATE_VARIABLE_REGEX = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
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

const parseTemplateSegments = (value: string) => {
  const segments: Array<{ type: 'text' | 'variable'; value: string }> = [];
  let lastIndex = 0;
  let match = TEMPLATE_VARIABLE_REGEX.exec(value);

  while (match) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: value.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'variable', value: match[1] });
    lastIndex = match.index + match[0].length;
    match = TEMPLATE_VARIABLE_REGEX.exec(value);
  }

  if (lastIndex < value.length) {
    segments.push({ type: 'text', value: value.slice(lastIndex) });
  }

  TEMPLATE_VARIABLE_REGEX.lastIndex = 0;
  return segments;
};

const isSchemaObject = (value: SchemaLeafType | OutputSchema): value is OutputSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

const buildSchemaFromDotPaths = (paths: string[]): OutputSchema => {
  const result: OutputSchema = {};

  paths
    .map((path) => path.trim())
    .filter(Boolean)
    .forEach((path) => {
      const keys = path
        .split('.')
        .map((k) => k.trim())
        .filter(Boolean);
      if (!keys.length) return;

      let current: OutputSchema = result;
      keys.forEach((key, index) => {
        const isLast = index === keys.length - 1;
        const existing = current[key];
        if (isLast) {
          current[key] = isSchemaObject(existing ?? 'unknown') ? existing : 'unknown';
          return;
        }
        if (!isSchemaObject(existing ?? 'unknown')) {
          current[key] = {};
        }
        current = current[key] as OutputSchema;
      });
    });

  return result;
};

const inferNodeOutputSchema = (node: Node): OutputSchema => {
  const subtype = String(node.data?.subtype || '');
  const config = (node.data?.config || {}) as Record<string, unknown>;

  switch (subtype) {
    case 'webhook':
      return {
        id: 'string',
        method: 'string',
        headers: 'object',
        query: 'object',
        body: 'object',
        received_at: 'string',
      };
    case 'receive_email':
      return {
        message_id: 'string',
        from: 'string',
        to: 'string',
        subject: 'string',
        body: 'string',
        html_body: 'string',
        received_at: 'string',
        attachments: 'array',
      };
    case 'schedule':
      return {
        tick_at: 'string',
        cron_expression: 'string',
        timezone: 'string',
      };
    case 'if_else':
      return {
        matched: 'boolean',
        evaluated_variable: 'string',
        compared_value: 'unknown',
        input: 'object',
      };
    case 'switch':
      return {
        matched_case: 'string',
        input: 'object',
      };
    case 'delay':
      return {
        resumed_at: 'string',
        wait_value: 'number',
        wait_unit: 'string',
        input: 'object',
      };
    case 'json_transform': {
      const keys = String(config.keys || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      return {
        ...(keys.length ? buildSchemaFromDotPaths(keys) : {}),
        _meta: {
          selected_keys: 'string',
        },
      };
    }
    case 'for_each':
      return {
        item: 'object',
        index: 'number',
        total: 'number',
      };
    case 'slack_msg':
      return {
        channel: 'string',
        message_ts: 'string',
        status: 'string',
      };
    case 'send_email':
      return {
        recipient: 'string',
        subject: 'string',
        status: 'string',
        sent_at: 'string',
      };
    case 'http_request':
      return {
        status_code: 'number',
        headers: 'object',
        body: 'object',
        raw_body: 'string',
      };
    case 'db_insert':
    case 'collection_insert':
      return {
        collection_id: 'string',
        record_id: 'string',
        status: 'string',
      };
    case 'collection_update':
      return {
        collection_id: 'string',
        record_id: 'string',
        status: 'string',
      };
    case 'collection_find':
      return {
        collection_id: 'string',
        count: 'number',
        items: 'array',
        payload: 'object',
      };
    case 'data_mapper': {
      const mappings = Array.isArray(config.mappings)
        ? (config.mappings as Array<Record<string, unknown>>)
        : [];
      const targets = mappings.map((m) => String(m.target || '').trim()).filter(Boolean);
      return {
        ...(targets.length ? buildSchemaFromDotPaths(targets) : {}),
        _meta: {
          mappings_count: 'number',
        },
      };
    }
    case 'jira_create_ticket':
      return {
        id: 'string',
        key: 'string',
        url: 'string',
        status: 'string',
      };
    case 'gemini_custom':
    case 'gemini_template':
      return {
        output_text: 'string',
        model: 'string',
        usage: {
          input_tokens: 'number',
          output_tokens: 'number',
        },
      };
    case 'manual_approval':
      return {
        approved: 'boolean',
        approver: 'string',
        decided_at: 'string',
      };
    default:
      return {
        result: 'unknown',
      };
  }
};

const getAvailableSchemasForNode = (
  selectedNodeId: string | null,
  nodes: Node[],
  edges: Edge[]
): AvailableNodeSchema[] => {
  if (!selectedNodeId) return [];

  const incomingByTarget = new Map<string, string[]>();
  edges.forEach((edge) => {
    const current = incomingByTarget.get(edge.target) || [];
    current.push(edge.source);
    incomingByTarget.set(edge.target, current);
  });

  const visited = new Set<string>([selectedNodeId]);
  const queue: string[] = [selectedNodeId];
  const upstreamNodeIds: string[] = [];

  while (queue.length) {
    const targetId = queue.shift();
    if (!targetId) continue;
    const previousNodeIds = incomingByTarget.get(targetId) || [];

    previousNodeIds.forEach((sourceId) => {
      if (visited.has(sourceId)) return;
      visited.add(sourceId);
      upstreamNodeIds.push(sourceId);
      queue.push(sourceId);
    });
  }

  return upstreamNodeIds
    .map((nodeId) => nodes.find((node) => node.id === nodeId))
    .filter((node): node is Node => Boolean(node))
    .map((node) => ({
      nodeId: node.id,
      nodeLabel: String(node.data?.label || node.id),
      schema: inferNodeOutputSchema(node),
    }));
};

function VariablePickerInput({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  multiline,
  rows = 4,
  availableSchemas,
}: VariablePickerInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const normalizedValue =
    typeof value === 'string' ? value : value == null ? '' : String(value);

  const insertVariable = (variablePath: string) => {
    const token = `{{${variablePath}}}`;
    const shouldAddSpace = Boolean(normalizedValue && !normalizedValue.endsWith(' '));
    onChange(`${normalizedValue}${shouldAddSpace ? ' ' : ''}${token}`);
    setIsOpen(false);
  };

  const renderSchemaTree = (schema: OutputSchema, nodeId: string, parentPath = '') => {
    return Object.entries(schema).map(([key, schemaValue]) => {
      const path = parentPath ? `${parentPath}.${key}` : key;
      const variablePath = `${nodeId}.${path}`;

      if (isSchemaObject(schemaValue)) {
        return (
          <details key={variablePath} className="group">
            <summary className="cursor-pointer list-none flex items-center gap-1.5 text-xs text-foreground/90 hover:text-foreground py-1">
              <ChevronRight className="w-3 h-3 text-muted-foreground transition-transform group-open:rotate-90" />
              <span className="font-medium">{key}</span>
            </summary>
            <div className="ml-4 border-l border-border pl-2">
              {renderSchemaTree(schemaValue, nodeId, path)}
            </div>
          </details>
        );
      }

      return (
        <button
          key={variablePath}
          type="button"
          onClick={() => insertVariable(variablePath)}
          className="w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs hover:bg-muted transition-colors"
        >
          <span className="flex items-center gap-1.5 truncate">
            <Variable className="w-3 h-3 text-primary shrink-0" />
            <span className="truncate">{key}</span>
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {schemaValue}
          </span>
        </button>
      );
    });
  };

  const segments = parseTemplateSegments(normalizedValue);
  const hasVariables = segments.some((segment) => segment.type === 'variable');

  return (
    <div className="space-y-2">
      <div className="relative">
        {multiline ? (
          <textarea
            placeholder={placeholder}
            rows={rows}
            className={`${className || ''} pr-10`}
            value={normalizedValue}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        ) : (
          <input
            type="text"
            placeholder={placeholder}
            className={`${className || ''} pr-10`}
            value={normalizedValue}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        )}

        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          disabled={disabled}
          className="absolute right-2 top-2 p-1.5 rounded-md border border-border bg-white hover:bg-muted transition-colors disabled:opacity-50"
          title="Wstaw zmienną"
        >
          <Zap className="w-3.5 h-3.5 text-amber-500" />
        </button>

        {isOpen && (
          <div className="absolute right-0 top-10 z-20 w-80 max-h-72 overflow-y-auto rounded-xl border border-border bg-white shadow-xl p-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 pb-2">
              Zmienne z poprzednich kroków
            </p>
            {availableSchemas.length === 0 ? (
              <div className="px-2 py-4 text-xs text-muted-foreground text-center">
                Brak poprzednich klocków w tym miejscu grafu.
              </div>
            ) : (
              <div className="space-y-2">
                {availableSchemas.map((nodeSchema) => (
                  <details
                    key={nodeSchema.nodeId}
                    className="rounded-lg border border-border/70 bg-muted/20"
                    open
                  >
                    <summary className="cursor-pointer list-none px-2.5 py-2 border-b border-border/60 text-xs font-semibold flex items-center gap-2">
                      <Braces className="w-3.5 h-3.5 text-primary" />
                      <span className="truncate">{nodeSchema.nodeLabel}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        ({nodeSchema.nodeId})
                      </span>
                    </summary>
                    <div className="p-1.5">
                      {renderSchemaTree(nodeSchema.schema, nodeSchema.nodeId)}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {hasVariables && (
        <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2 text-xs flex flex-wrap items-center gap-1.5">
          {segments.map((segment, index) =>
            segment.type === 'variable' ? (
              <span
                key={`${segment.value}-${index}`}
                className="inline-flex items-center gap-1 rounded-full bg-slate-200 text-slate-700 border border-slate-300 px-2 py-0.5"
              >
                <Variable className="w-3 h-3" />
                {segment.value}
              </span>
            ) : (
              <span
                key={`${segment.value}-${index}`}
                className="text-muted-foreground whitespace-pre-wrap"
              >
                {segment.value}
              </span>
            )
          )}
        </div>
      )}
    </div>
  );
}

function IfElseRuleBuilder({
  value,
  onChange,
  availableSchemas,
  disabled,
}: IfElseRuleBuilderProps) {
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

  const removeNodeInTree = useCallback(
    (group: IfElseRuleGroup, nodeId: string): IfElseRuleGroup => {
      const prune = (
        node: IfElseRule | IfElseRuleGroup
      ): IfElseRule | IfElseRuleGroup | null => {
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
    },
    []
  );

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
    const shouldHideValueInput =
      rule.operator === 'is_empty' || rule.operator === 'is_not_empty';
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

        <VariablePickerInput
          placeholder="Pole wejściowe (np. {{node_1.amount}})"
          className="w-full text-xs border-border rounded-md border p-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          value={rule.field}
          onChange={(next) => updateRule(rule.id, { field: next })}
          availableSchemas={availableSchemas}
          disabled={disabled}
        />

        <div className="grid grid-cols-2 gap-2">
          <select
            className="w-full text-xs border-border rounded-md border p-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            value={rule.operator}
            onChange={(e) =>
              updateRule(rule.id, { operator: e.target.value as RuleOperator })
            }
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
            onChange={(e) =>
              updateRule(rule.id, { value_type: e.target.value as RuleValueType })
            }
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
          <VariablePickerInput
            placeholder="Wartość porównania"
            className="w-full text-xs border-border rounded-md border p-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={rule.value}
            onChange={(next) => updateRule(rule.id, { value: next })}
            availableSchemas={availableSchemas}
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
            onChange={(e) =>
              updateGroupCondition(group.id, e.target.value as RuleGroupCondition)
            }
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
          Buduj warunki jako drzewo reguł. Każda grupa może używać operatora <b>AND</b>{' '}
          lub <b>OR</b>.
        </p>
      </div>
      {renderGroup(ast, 0, true)}
    </div>
  );
}

const nodeBlocks = [
  {
    category: 'Wyzwalacze',
    items: [
      {
        type: 'trigger',
        subtype: 'webhook',
        label: 'Odbierz Webhook',
        icon: Webhook,
        description: 'HTTP endpoint',
      },
      {
        type: 'trigger',
        subtype: 'receive_email',
        label: 'Odbierz Email',
        icon: Mail,
        description: 'Oczekuje na maile',
      },
      {
        type: 'trigger',
        subtype: 'schedule',
        label: 'Harmonogram (Cron)',
        icon: Clock,
        description: 'Uruchamia cyklicznie',
      },
    ],
  },
  {
    category: 'Bramki logiczne i Narzędzia',
    items: [
      {
        type: 'logic',
        subtype: 'if_else',
        label: 'Jeśli / To (Warunek)',
        icon: GitBranch,
        description: 'Rozgałęzienie',
      },
      {
        type: 'logic',
        subtype: 'delay',
        label: 'Opóźnienie czasowe',
        icon: Clock,
        description: 'Pause & Resume (Baza)',
      },
      {
        type: 'logic',
        subtype: 'json_transform',
        label: 'Filtruj Dane',
        icon: FileJson,
        description: 'Wybiera tylko wybrane pola',
      },
      {
        type: 'logic',
        subtype: 'switch',
        label: 'Switch (Wiele sciezek)',
        icon: GitBranch,
        description: 'WIelokrotne rozgałęzienie',
      },
      {
        type: 'logic',
        subtype: 'for_each',
        label: 'Pętla (For Each)',
        icon: GitBranch,
        description: 'Uruchamia podprocesy',
      },
      {
        type: 'logic',
        subtype: 'manual_approval',
        label: 'Ręczna Akceptacja',
        icon: CheckCircle,
        description: 'Wstrzymuje proces do zatwierdzenia',
      },
    ],
  },
  {
    category: 'Akcje',
    items: [
      {
        type: 'action',
        subtype: 'slack_msg',
        label: 'Wyślij na Slack',
        icon: MessageSquare,
        description: 'Powiadomienie',
      },
      {
        type: 'action',
        subtype: 'send_email',
        label: 'Wyślij Email',
        icon: Mail,
        description: 'Wiadomość z systemu',
      },
      {
        type: 'action',
        subtype: 'http_request',
        label: 'Zewnętrzny Webhook API',
        icon: Globe,
        description: 'Request HTTP (GET/POST)',
      },
      {
        type: 'action',
        subtype: 'collection_insert',
        label: 'Kolekcja: Dodaj rekord',
        icon: Database,
        description: 'Wstawia nowy rekord do kolekcji',
      },
      {
        type: 'action',
        subtype: 'collection_update',
        label: 'Kolekcja: Aktualizuj rekord',
        icon: Database,
        description: 'Aktualizuje rekord wg warunku',
      },
      {
        type: 'action',
        subtype: 'collection_find',
        label: 'Kolekcja: Wyszukaj rekordy',
        icon: Database,
        description: 'Pobiera rekordy i przekazuje dalej',
      },
      {
        type: 'action',
        subtype: 'data_mapper',
        label: 'Mapowanie Danych',
        icon: FileJson,
        description: 'Transformacja JSON',
      },
      {
        type: 'action',
        subtype: 'jira_create_ticket',
        label: 'Jira: Utwórz Ticket',
        icon: Trello,
        description: 'Tworzy zgłoszenie w JIRA',
      },
      {
        type: 'action',
        subtype: 'gemini_custom',
        label: 'Gemini: Własny Prompt',
        icon: Sparkles,
        description: 'Napisz dowolne polecenie do AI',
      },
      {
        type: 'action',
        subtype: 'gemini_template',
        label: 'Gemini: Gotowe Szablony',
        icon: Brain,
        description: 'Szybkie operacje na tekście bez pisania promptów',
      },
    ],
  },
];

export default function WorkflowEditor({ onBack, workflowId }: WorkflowEditorProps) {
  const { workflows } = useWorkflows();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(
    null
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [savedWorkflowId, setSavedWorkflowId] = useState<string | null>(null);
  const [loadedWorkflowName, setLoadedWorkflowName] = useState<string>('Nowy Workflow');
  const [isReadOnly, setIsReadOnly] = useState<boolean>(false);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [nodePanelTab, setNodePanelTab] = useState<'config' | 'test'>('config');
  const [testInputJson, setTestInputJson] = useState<string>('{\n  "sample": "value"\n}');
  const [testResultJson, setTestResultJson] = useState<string>('');
  const [testError, setTestError] = useState<string | null>(null);
  const [isNodeTestRunning, setIsNodeTestRunning] = useState<boolean>(false);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  const availableSchemas = useMemo(
    () => getAvailableSchemasForNode(selectedNodeId, nodes, edges),
    [selectedNodeId, nodes, edges]
  );

  const onConnect = useCallback(
    (params: Connection | Edge) => {
      if (isReadOnly) return;
      setEdges((eds) => addEdge({ ...params, animated: true }, eds));
    },
    [setEdges, isReadOnly]
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (connection.source === connection.target) return false;

      const targetNode = nodes.find((n) => n.id === connection.target);
      if (targetNode?.type === 'trigger') return false;

      return true;
    },
    [nodes]
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      setSelectedNodeId(selectedNodes.length === 1 ? selectedNodes[0].id : null);
    },
    []
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (isReadOnly) return;
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow/type');
      const subtype = event.dataTransfer.getData('application/reactflow/subtype');
      const label = event.dataTransfer.getData('application/reactflow/label');
      const description = event.dataTransfer.getData('application/reactflow/description');

      if (typeof type === 'undefined' || !type || !reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: getId(),
        type,
        position,
        data: {
          label,
          subtype,
          config: {},
          description: description || 'Przeciągnięty klocek',
        },
      };

      setNodes((nds) => nds.concat(newNode));
      setSelectedNodeId(newNode.id);
    },
    [reactFlowInstance, setNodes, isReadOnly]
  );

  const onDragStart = (
    event: React.DragEvent,
    nodeType: string,
    subtype: string,
    label: string,
    description: string
  ) => {
    event.dataTransfer.setData('application/reactflow/type', nodeType);
    event.dataTransfer.setData('application/reactflow/subtype', subtype);
    event.dataTransfer.setData('application/reactflow/label', label);
    event.dataTransfer.setData('application/reactflow/description', description);
    event.dataTransfer.effectAllowed = 'move';
  };

  // Funkcja aktualizująca config wybranego węzła
  const updateNodeConfig = (key: string, value: any) => {
    if (isReadOnly) return;
    if (!selectedNodeId) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === selectedNodeId) {
          return {
            ...n,
            data: {
              ...n.data,
              config: {
                ...((n.data.config as Record<string, any>) || {}),
                [key]: value,
              },
            },
          };
        }
        return n;
      })
    );
  };

  // Logika transformacji list UI -> JSON przed zapisem na backend
  const buildFinalNodeConfig = (config: any) => {
    const finalConfig = { ...config };

    if (Array.isArray(config.headers_list)) {
      finalConfig.headers = config.headers_list.reduce((acc: any, curr: any) => {
        if (curr.key && curr.key.trim()) acc[curr.key.trim()] = curr.value;
        return acc;
      }, {});
      delete finalConfig.headers_list;
    }

    if (Array.isArray(config.query_params_list)) {
      finalConfig.query_params = config.query_params_list.reduce(
        (acc: any, curr: any) => {
          if (curr.key && curr.key.trim()) acc[curr.key.trim()] = curr.value;
          return acc;
        },
        {}
      );
      delete finalConfig.query_params_list;
    }

    if (finalConfig.body_type === 'json' && Array.isArray(config.body_list)) {
      finalConfig.body = config.body_list.reduce((acc: any, curr: any) => {
        if (curr.key && curr.key.trim()) acc[curr.key.trim()] = curr.value;
        return acc;
      }, {});
      delete finalConfig.body_list;
    }

    return finalConfig;
  };

  const handleSave = async () => {
    if (isReadOnly) {
      alert('Ten proces jest uruchomiony — zatrzymaj go, aby odblokować edycję.');
      return;
    }
    // Walidacja główna
    const hasTrigger = nodes.some((n) => n.type === 'trigger');
    if (!hasTrigger) {
      alert('Błąd: Twój proces musi zawierać co najmniej jeden wyzwalacz!');
      return;
    }

    // Serializacja danych do formatu zgodnego ze schematem + konwersja dynamicznych list
    const payload = {
      name: `Nowy Workflow - ${new Date().toLocaleTimeString()}`,
      description: 'Wygenerowano z kreatora',
      graph_json: {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: {
            subtype: n.data.subtype,
            label: n.data.label,
            config: buildFinalNodeConfig(n.data.config || {}),
          },
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle || null,
          targetHandle: e.targetHandle || null,
        })),
      },
    };

    // Wysyłanie do API
    try {
      console.log('Wysyłam payload: ', payload);
      const response = await createWorkflow(payload);
      setSavedWorkflowId(response.id);
      alert('Proces pomyślnie zapisany!');
    } catch (error) {
      console.error(error);
      alert('Wystąpił błąd podczas zapisu do bazy danych!');
    }
  };

  const handleTest = async () => {
    if (isReadOnly) {
      alert('Ten proces jest uruchomiony — zatrzymaj go, aby odblokować edycję.');
      return;
    }
    if (!savedWorkflowId) {
      alert('Najpierw zapisz proces, aby móc go przetestować!');
      return;
    }

    try {
      await executeWorkflowTest(savedWorkflowId);
      alert('Test procesu uruchomiony pomyślnie!');
    } catch (error) {
      console.error(error);
      alert('Wystąpił błąd podczas uruchamiania testu procesu!');
    }
  };

  const handleTestSelectedNode = async () => {
    if (!selectedNode) {
      return;
    }

    let parsedInput: Record<string, unknown>;
    try {
      const candidate = JSON.parse(testInputJson || '{}');
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        setTestError('Input testowy musi być poprawnym obiektem JSON.');
        setTestResultJson('');
        return;
      }
      parsedInput = candidate as Record<string, unknown>;
    } catch {
      setTestError('Niepoprawny JSON wejściowy.');
      setTestResultJson('');
      return;
    }

    setIsNodeTestRunning(true);
    setTestError(null);
    setTestResultJson('');

    try {
      const response = await testWorkflowNode({
        type: String(selectedNode.type),
        subtype: String(selectedNode.data.subtype || ''),
        config: buildFinalNodeConfig(
          ((selectedNode.data.config as Record<string, unknown>) || {}) as Record<
            string,
            unknown
          >
        ) as Record<string, unknown>,
        input_data: parsedInput,
      });

      setTestResultJson(JSON.stringify(response.output ?? {}, null, 2));
    } catch (error) {
      console.error(error);
      setTestError(error instanceof Error ? error.message : 'Błąd testowania węzła.');
    } finally {
      setIsNodeTestRunning(false);
    }
  };

  const handlePublish = async () => {
    if (isReadOnly) {
      alert('Ten proces jest uruchomiony — zatrzymaj go, aby odblokować edycję.');
      return;
    }
    if (!savedWorkflowId) {
      alert('Najpierw zapisz proces, aby móc go opublikować!');
      return;
    }

    try {
      await publishWorkflow(savedWorkflowId);
      alert('Proces został pomyślnie opublikowany!');
    } catch (error) {
      console.error(error);
      alert('Wystąpił błąd podczas publikacji procesu!');
    }
  };

  // Switch generujący formularz pod konkretny typ klocka
  const renderConfigForm = () => {
    if (!selectedNode) return null;
    const subtype = selectedNode.data.subtype as string;
    const config = (selectedNode.data.config as Record<string, any>) || {};

    switch (subtype) {
      case 'webhook':
        const webhookUrl = `http://localhost:8000/api/v1/workflows/${savedWorkflowId || '{ID_PROCESU}'}/trigger`;
        return (
          <div className="space-y-4">
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <h4 className="text-sm font-semibold text-foreground mb-2">
                Twój adres Webhook
              </h4>
              <div className="flex items-center gap-2 mb-3">
                <div className="bg-white p-2 flex-1 border border-border rounded-md text-[10px] font-mono text-muted-foreground overflow-x-auto shadow-sm whitespace-nowrap">
                  [POST] {webhookUrl}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl);
                    alert('Skopiowano do schowka!');
                  }}
                  className="p-2 bg-white border border-border rounded-md hover:bg-muted transition-colors text-foreground shadow-sm shrink-0"
                  title="Kopiuj URL"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                Zapisz proces, a następnie użyj powyższego adresu w systemie zewnętrznym.
              </p>
            </div>
          </div>
        );

      case 'slack_msg':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Gdzie wysłać powiadomienie?
              </label>
              <VariablePickerInput
                placeholder="np. #ogolny lub @janek"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.channel || ''}
                onChange={(value) => updateNodeConfig('channel', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Treść wiadomości
              </label>
              <VariablePickerInput
                placeholder="Wpisz treść, np.: Mamy nowe zgłoszenie w systemie!"
                rows={4}
                multiline
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.message || ''}
                onChange={(value) => updateNodeConfig('message', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
            </div>
          </div>
        );

      case 'if_else':
        return (
          <div className="space-y-4">
            <IfElseRuleBuilder
              value={config.rule_tree || config}
              onChange={(nextTree) => updateNodeConfig('rule_tree', nextTree)}
              availableSchemas={availableSchemas}
              disabled={isReadOnly}
            />
          </div>
        );

      case 'db_insert':
      case 'collection_insert':
      case 'collection_update':
      case 'collection_find': {
        const mappings = Array.isArray(config.mappings) ? config.mappings : [];
        const matchRules = Array.isArray(config.match_rules) ? config.match_rules : [];
        const isFind = subtype === 'collection_find';
        const isUpdate = subtype === 'collection_update';
        const supportsMapping =
          subtype === 'db_insert' ||
          subtype === 'collection_insert' ||
          subtype === 'collection_update';

        const addMapping = () =>
          updateNodeConfig('mappings', [
            ...mappings,
            { id: Date.now(), target: '', source: '' },
          ]);
        const updateMapping = (idx: number, field: 'target' | 'source', val: string) => {
          const next = [...mappings];
          next[idx] = { ...next[idx], [field]: val };
          updateNodeConfig('mappings', next);
        };
        const removeMapping = (idx: number) =>
          updateNodeConfig(
            'mappings',
            mappings.filter((_: any, i: number) => i !== idx)
          );

        const addMatchRule = () =>
          updateNodeConfig('match_rules', [
            ...matchRules,
            { id: Date.now(), field: '', value: '' },
          ]);
        const updateMatchRule = (idx: number, field: 'field' | 'value', val: string) => {
          const next = [...matchRules];
          next[idx] = { ...next[idx], [field]: val };
          updateNodeConfig('match_rules', next);
        };
        const removeMatchRule = (idx: number) =>
          updateNodeConfig(
            'match_rules',
            matchRules.filter((_: any, i: number) => i !== idx)
          );

        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Kolekcja docelowa
              </label>
              <select
                className="w-full text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                value={config.collection_id || ''}
                onChange={(e) => updateNodeConfig('collection_id', e.target.value)}
              >
                <option value="">-- Wybierz kolekcję --</option>
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
              </select>
              {collections.length === 0 && (
                <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  Brak kolekcji. Utwórz je w zakładce <b>Kolekcje</b>.
                </p>
              )}
            </div>

            {(isUpdate || isFind) && (
              <div className="space-y-2 border-t border-border pt-4">
                <label className="text-sm font-medium text-foreground">
                  Warunki wyszukiwania rekordu
                </label>
                {matchRules.map((rule: any, idx: number) => (
                  <div key={rule.id || idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Pole (np. email)"
                      className="w-1/2 text-xs p-2 border rounded bg-white"
                      value={rule.field || ''}
                      onChange={(e) => updateMatchRule(idx, 'field', e.target.value)}
                    />
                    <VariablePickerInput
                      placeholder="Wartość dopasowania"
                      className="w-full text-xs p-2 border rounded bg-white"
                      value={rule.value || ''}
                      onChange={(value) => updateMatchRule(idx, 'value', value)}
                      availableSchemas={availableSchemas}
                      disabled={isReadOnly}
                    />
                    <button
                      onClick={() => removeMatchRule(idx)}
                      className="text-red-500 hover:text-red-700 p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addMatchRule}
                  className="text-xs px-3 py-1.5 rounded border border-border bg-white hover:bg-muted"
                >
                  + Dodaj warunek
                </button>
                {isFind && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-foreground">
                      Limit wyników
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      className="w-full text-xs p-2 border rounded bg-white"
                      value={config.limit || 10}
                      onChange={(e) => updateNodeConfig('limit', Number(e.target.value))}
                    />
                  </div>
                )}
              </div>
            )}

            {supportsMapping && (
              <div className="space-y-2 border-t border-border pt-4">
                <label className="text-sm font-medium text-foreground">
                  Mapowanie danych do rekordu
                </label>
                {mappings.map((mapping: any, idx: number) => (
                  <div key={mapping.id || idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Pole docelowe (np. customer_name)"
                      className="w-1/2 text-xs p-2 border rounded bg-white"
                      value={mapping.target || ''}
                      onChange={(e) => updateMapping(idx, 'target', e.target.value)}
                    />
                    <VariablePickerInput
                      placeholder="Źródło (np. {{node_1.body.name}})"
                      className="w-full text-xs p-2 border rounded bg-white"
                      value={mapping.source || ''}
                      onChange={(value) => updateMapping(idx, 'source', value)}
                      availableSchemas={availableSchemas}
                      disabled={isReadOnly}
                    />
                    <button
                      onClick={() => removeMapping(idx)}
                      className="text-red-500 hover:text-red-700 p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addMapping}
                  className="text-xs px-3 py-1.5 rounded border border-border bg-white hover:bg-muted"
                >
                  + Dodaj mapowanie
                </button>
              </div>
            )}
          </div>
        );
      }

      // Formularz wysyłki e-mail
      case 'send_email':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Odbiorca (Adres e-mail)
              </label>
              <VariablePickerInput
                placeholder="np. biuro@firma.pl"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.recipient || ''}
                onChange={(value) => updateNodeConfig('recipient', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Temat wiadomości
              </label>
              <VariablePickerInput
                placeholder="np. Masz nowe zamówienie!"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.subject || ''}
                onChange={(value) => updateNodeConfig('subject', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Treść maila</label>
              <VariablePickerInput
                placeholder="Wpisz treść wiadomości, którą chcesz wysłać..."
                rows={5}
                multiline
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.body || ''}
                onChange={(value) => updateNodeConfig('body', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
            </div>
            <div className="p-3 mt-4 bg-muted/50 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground leading-relaxed text-center">
                System użyje globalnych ustawień SMTP z zakładki{' '}
                <span className="font-semibold text-foreground">Settings</span> do
                wysłania tej wiadomości.
              </p>
            </div>
          </div>
        );

      case 'gemini_custom':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Prompt dla Gemini
              </label>
              <VariablePickerInput
                placeholder="Np. Podsumuj poniższy tekst i wypisz 3 najważniejsze wnioski..."
                rows={5}
                multiline
                className="w-full text-sm border-border rounded-md p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white shadow-sm"
                value={config.prompt || ''}
                onChange={(value) => updateNodeConfig('prompt', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
              <p className="text-xs text-muted-foreground">
                Możesz używać zmiennych z poprzednich kroków, np.{' '}
                <code className="font-mono">{'{{email.body}}'}</code>.
              </p>
            </div>
          </div>
        );

      case 'gemini_template':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Wybierz szablon
              </label>
              <select
                className="w-full text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                value={config.template_type || 'summarize'}
                onChange={(e) => updateNodeConfig('template_type', e.target.value)}
              >
                <option value="summarize">Podsumuj tekst</option>
                <option value="translate_en">Przetłumacz na Angielski</option>
                <option value="extract_key_info">Wyciągnij kluczowe informacje</option>
                <option value="fix_language">Popraw błędy językowe</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Zmienna wejściowa do przetworzenia
              </label>
              <VariablePickerInput
                placeholder="np. {{email.body}}"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.target_variable || ''}
                onChange={(value) => updateNodeConfig('target_variable', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
              <p className="text-xs text-muted-foreground">
                Wpisz wartość lub zmienną w formacie{' '}
                <code className="font-mono">{'{{zmienna}}'}</code>.
              </p>
            </div>
          </div>
        );

      // Formularz zewnętrznego zapytania HTTP
      case 'http_request': {
        // Zamiana starych, stałych obiektów na płaskie tablice do renderowania
        const getListForUI = (listKey: string, objKey: string) => {
          if (config[listKey] !== undefined) return config[listKey];
          if (
            config[objKey] !== undefined &&
            config[objKey] !== null &&
            typeof config[objKey] === 'object' &&
            !Array.isArray(config[objKey])
          ) {
            return Object.entries(config[objKey]).map(([k, v], i) => ({
              id: Date.now() + i,
              key: k,
              value: String(v),
            }));
          }
          return [];
        };

        const headersList = getListForUI('headers_list', 'headers');
        const paramsList = getListForUI('query_params_list', 'query_params');
        const bodyList = getListForUI('body_list', 'body');

        const addListItem = (keyName: string, list: any[]) => {
          if (isReadOnly) return;
          updateNodeConfig(keyName, [...list, { id: Date.now(), key: '', value: '' }]);
        };
        const updateListItem = (
          keyName: string,
          list: any[],
          idx: number,
          field: string,
          val: string
        ) => {
          if (isReadOnly) return;
          const newList = [...list];
          newList[idx] = { ...newList[idx], [field]: val };
          updateNodeConfig(keyName, newList);
        };
        const removeListItem = (keyName: string, list: any[], idx: number) => {
          if (isReadOnly) return;
          updateNodeConfig(
            keyName,
            list.filter((_: any, i: number) => i !== idx)
          );
        };

        const renderDynamicList = (title: string, configKey: string, list: any[]) => (
          <div className="space-y-2 mt-4 border-t border-border pt-4">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium text-foreground">{title}</label>
              <button
                onClick={() => addListItem(configKey, list)}
                className={`text-xs ${isReadOnly ? 'text-muted-foreground' : 'text-primary hover:underline'}`}
                disabled={isReadOnly}
              >
                + Dodaj wiersz
              </button>
            </div>
            {list.map((item: any, idx: number) => (
              <div key={item.id || idx} className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="Klucz (np. Auth)"
                  className="w-1/3 text-xs p-2 border rounded disabled:opacity-60 disabled:bg-slate-50 disabled:cursor-not-allowed bg-white shadow-sm"
                  value={item.key}
                  onChange={(e) =>
                    updateListItem(configKey, list, idx, 'key', e.target.value)
                  }
                  disabled={isReadOnly}
                />
                <select
                  className="w-1/4 text-xs p-2 border rounded disabled:opacity-60 disabled:bg-slate-50 disabled:cursor-not-allowed bg-white shadow-sm"
                  value={item.type || 'string'}
                  onChange={(e) =>
                    updateListItem(configKey, list, idx, 'type', e.target.value)
                  }
                  disabled={isReadOnly}
                >
                  <option value="string">String</option>
                  <option value="int">Integer</option>
                  <option value="bool">Boolean</option>
                  <option value="json">JSON</option>
                </select>
                <input
                  type="text"
                  placeholder="Wartość"
                  className="w-full text-xs p-2 border rounded disabled:opacity-60 disabled:bg-slate-50 disabled:cursor-not-allowed bg-white shadow-sm"
                  value={item.value}
                  onChange={(e) =>
                    updateListItem(configKey, list, idx, 'value', e.target.value)
                  }
                  disabled={isReadOnly}
                />
                <button
                  onClick={() => removeListItem(configKey, list, idx)}
                  className={`shrink-0 p-1.5 rounded-md transition-colors ${isReadOnly ? 'text-muted-foreground' : 'text-red-500 hover:bg-red-50'}`}
                  disabled={isReadOnly}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            {list.length === 0 && (
              <p className="text-xs text-muted-foreground italic text-center p-2 bg-muted/20 rounded border border-dashed border-border">
                Brak zdefiniowanych kluczy. Kliknij "Dodaj wiersz".
              </p>
            )}
          </div>
        );

        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Metoda i Adres URL
              </label>
              <div className="flex gap-2">
                <select
                  className="w-1/3 text-sm border-border rounded-md border p-2 focus:outline-none bg-white shadow-sm"
                  value={config.method || 'GET'}
                  onChange={(e) => updateNodeConfig('method', e.target.value)}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                </select>
                <div className="w-2/3">
                  <VariablePickerInput
                    placeholder="https://api.com/v1/..."
                    className="w-full text-sm border-border rounded-md border p-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={config.url || ''}
                    onChange={(value) => updateNodeConfig('url', value)}
                    availableSchemas={availableSchemas}
                    disabled={isReadOnly}
                  />
                </div>
              </div>
            </div>

            {renderDynamicList('Parametry URL (Query)', 'query_params_list', paramsList)}
            {renderDynamicList('Nagłówki (Headers)', 'headers_list', headersList)}

            {['POST', 'PUT', 'PATCH'].includes(config.method || 'GET') && (
              <div className="space-y-2 mt-4 border-t border-border pt-4">
                <label className="text-sm font-medium text-foreground">
                  Typ Payloadu (Body)
                </label>
                <select
                  className="w-full text-sm border-border rounded-md shadow-sm border p-2.5 bg-white mb-2"
                  value={config.body_type || 'json'}
                  onChange={(e) => updateNodeConfig('body_type', e.target.value)}
                >
                  <option value="json">Dynamiczny Formularz JSON (Zalecane)</option>
                  <option value="raw">Raw (Wklejony surowy tekst / kod)</option>
                </select>

                {config.body_type === 'raw' ? (
                  <VariablePickerInput
                    placeholder='{"key": "{{variable}}"}'
                    rows={4}
                    multiline
                    className="w-full font-mono text-xs border rounded-md shadow-sm p-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    value={typeof config.body === 'string' ? config.body : ''}
                    onChange={(value) => updateNodeConfig('body', value)}
                    availableSchemas={availableSchemas}
                    disabled={isReadOnly}
                  />
                ) : (
                  renderDynamicList('Pola Body (Klucz-Wartość)', 'body_list', bodyList)
                )}
              </div>
            )}
          </div>
        );
      }

      // Formularz opóźnienia czasowego
      case 'delay':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Zatrzymaj proces na czas
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="np. 15"
                  min="0"
                  className="w-1/2 text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={config.value || ''}
                  onChange={(e) => updateNodeConfig('value', e.target.value)}
                />
                <select
                  className="w-1/2 text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                  value={config.unit || 'minutes'}
                  onChange={(e) => updateNodeConfig('unit', e.target.value)}
                >
                  <option value="seconds">Sekundy</option>
                  <option value="minutes">Minuty</option>
                  <option value="hours">Godziny</option>
                  <option value="days">Dni</option>
                </select>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Po upłynięciu wskazanego czasu proces automatycznie wznowi działanie w
                tle.
              </p>
            </div>
          </div>
        );

      // Formularz transformacji i filtrowania JSON
      case 'json_transform':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Zostaw tylko wybrane pola z poprzedniego kroku
              </label>
              <VariablePickerInput
                placeholder="np. id_klienta, kwota, status"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.keys || ''}
                onChange={(value) => updateNodeConfig('keys', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Wypisz po przecinku pola JSON, które mają zostać przekazane dalej. Reszta
                zostanie odrzucona (odchudzenie payloadu).
              </p>
            </div>
          </div>
        );

      // Formularz oczekiwania na wiadomość email
      case 'receive_email':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Filtruj Nadawcę (Opcjonalnie)
              </label>
              <VariablePickerInput
                placeholder="np. faktury@firma.pl"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.from_filter || ''}
                onChange={(value) => updateNodeConfig('from_filter', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Uruchom tylko jeśli nadawca zawiera ten tekst.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Filtruj Temat (Opcjonalnie)
              </label>
              <VariablePickerInput
                placeholder="np. Awaria systemu"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.subject_filter || ''}
                onChange={(value) => updateNodeConfig('subject_filter', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Uruchom tylko jeśli temat zawiera ten tekst.
              </p>
            </div>
            <div className="p-3 mt-4 bg-primary/5 rounded-lg border border-primary/20">
              <p className="text-xs text-muted-foreground leading-relaxed text-center">
                Ten proces uruchomi się automatycznie dla nowych wiadomości przy użyciu
                globalnej konfiguracji{' '}
                <span className="font-semibold text-primary">IMAP</span> z panelu
                Settings.
              </p>
            </div>
          </div>
        );

      // Formularz harmonogramu wykonywania akcji
      case 'schedule':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Typ harmonogramu
              </label>
              <select
                className="w-full text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                value={config.schedule_type || 'interval'}
                onChange={(e) => updateNodeConfig('schedule_type', e.target.value)}
              >
                <option value="interval">Interwał (np. co X minut)</option>
                <option value="cron">Wyrażenie Cron</option>
              </select>
            </div>

            {(!config.schedule_type || config.schedule_type === 'interval') && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Co ile uruchamiać?
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    placeholder="np. 15"
                    className="w-1/2 text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={config.interval_value || '15'}
                    onChange={(e) => updateNodeConfig('interval_value', e.target.value)}
                  />
                  <select
                    className="w-1/2 text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                    value={config.interval_unit || 'minutes'}
                    onChange={(e) => updateNodeConfig('interval_unit', e.target.value)}
                  >
                    <option value="minutes">Minut</option>
                    <option value="hours">Godzin</option>
                    <option value="days">Dni</option>
                  </select>
                </div>
              </div>
            )}

            {config.schedule_type === 'cron' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Wyrażenie Cron
                </label>
                <VariablePickerInput
                  placeholder="np. 0 8 * * *"
                  className="w-full text-sm font-mono border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={config.cron_expression || '0 8 * * *'}
                  onChange={(value) => updateNodeConfig('cron_expression', value)}
                  availableSchemas={availableSchemas}
                  disabled={isReadOnly}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Przykład: <code>0 8 * * *</code> oznacza codziennie o 8:00 UTC.
                </p>
              </div>
            )}
            <div className="p-3 mt-4 bg-primary/5 rounded-lg border border-primary/20">
              <p className="text-xs text-muted-foreground leading-relaxed text-center">
                Harmonogram jest weryfikowany na serwerze i automatycznie synchronizowany
                po zapisaniu procesu.
              </p>
            </div>
          </div>
        );

      // Formularz węzła Switch
      case 'switch': {
        const cases = config.cases || [];

        const addCase = () => {
          const newCases = [
            ...cases,
            { id: `case_${Date.now()}`, operator: 'equals', value: '' },
          ];
          updateNodeConfig('cases', newCases);
        };

        const updateCase = (idx: number, field: string, val: string) => {
          const newCases = [...cases];
          newCases[idx] = { ...newCases[idx], [field]: val };
          updateNodeConfig('cases', newCases);
        };

        const removeCase = (idx: number) => {
          const newCases = cases.filter((_: any, i: number) => i !== idx);
          updateNodeConfig('cases', newCases);
        };

        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Zmienna wejściowa do sprawdzenia
              </label>
              <VariablePickerInput
                placeholder="np. status_zamowienia"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.variable || ''}
                onChange={(value) => updateNodeConfig('variable', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
            </div>

            <div className="space-y-3 mt-4">
              <label className="text-sm font-medium text-foreground">
                Ścieżki i warunki
              </label>
              {cases.map((c: any, idx: number) => (
                <div
                  key={c.id}
                  className="p-3 border border-border rounded-md bg-white space-y-2 relative shadow-sm"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-semibold text-primary">
                      Wyjście: {c.id}
                    </span>
                    <button
                      onClick={() => removeCase(idx)}
                      className="text-red-500 hover:text-red-700 bg-red-50 p-1 rounded transition-colors shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <select
                    className="w-full text-xs border-border rounded-md shadow-sm border p-2 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                    value={c.operator || 'equals'}
                    onChange={(e) => updateCase(idx, 'operator', e.target.value)}
                  >
                    <option value="equals">Jest równe dokładnie</option>
                    <option value="greater">Jest większe niż</option>
                    <option value="less">Jest mniejsze niż</option>
                    <option value="contains">Zawiera tekst</option>
                  </select>
                  <VariablePickerInput
                    placeholder="Wartość (np. 100 lub 'Opłacone')"
                    className="w-full text-xs border-border rounded-md shadow-sm p-2 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={c.value || ''}
                    onChange={(value) => updateCase(idx, 'value', value)}
                    availableSchemas={availableSchemas}
                    disabled={isReadOnly}
                  />
                </div>
              ))}
              <button
                onClick={addCase}
                className="w-full py-2 text-xs font-medium text-primary border border-primary/30 rounded-md hover:bg-primary/5 transition-colors"
              >
                + Dodaj warunek
              </button>
              <div className="p-3 bg-muted/50 rounded-lg border border-border mt-2">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Zawsze aktywne jest również wyjście{' '}
                  <span className="font-semibold text-foreground">default</span>, którym
                  polecą dane, jeśli żaden z powyższych warunków nie zostanie spełniony.
                </p>
              </div>
            </div>
          </div>
        );
      }

      case 'for_each':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Zmienna tablicowa
              </label>
              <VariablePickerInput
                placeholder="np. lista_maili"
                className="w-full text-sm border-border rounded-md shadow-sm p-2.5 border focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={config.array_variable || ''}
                onChange={(value) => updateNodeConfig('array_variable', value)}
                availableSchemas={availableSchemas}
                disabled={isReadOnly}
              />
              <p className="text-[10px] text-muted-foreground">
                Klucz w JSON, który zawiera tablicę danych do iteracji.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Uruchom Podproces
              </label>
              <select
                className="w-full text-sm border-border rounded-md shadow-sm border p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
                value={config.target_workflow_id || ''}
                onChange={(e) => updateNodeConfig('target_workflow_id', e.target.value)}
              >
                <option value="">-- Wybierz docelowy workflow --</option>
                {workflows?.map((w: any) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                Dla każdego elementu z tablicy zostanie osobno uruchomiony wybrany proces.
              </p>
            </div>
          </div>
        );

      case 'data_mapper': {
        const mappings = config.mappings || [];

        const addMapping = () => {
          updateNodeConfig('mappings', [
            ...mappings,
            { id: Date.now(), source: '', target: '', type: 'string' },
          ]);
        };
        const updateMapping = (idx: number, field: string, val: string) => {
          const newMappings = [...mappings];
          newMappings[idx] = { ...newMappings[idx], [field]: val };
          updateNodeConfig('mappings', newMappings);
        };
        const removeMapping = (idx: number) => {
          updateNodeConfig(
            'mappings',
            mappings.filter((_: any, i: number) => i !== idx)
          );
        };

        return (
          <div className="space-y-4">
            <label className="text-sm font-medium text-foreground">
              Reguły mapowania (Z -&gt; Do)
            </label>
            <div className="space-y-2">
              {mappings.map((m: any, idx: number) => (
                <div
                  key={m.id || idx}
                  className="p-2 border border-border rounded-md bg-white space-y-2 relative shadow-sm"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                      Reguła {idx + 1}
                    </span>
                    <button
                      onClick={() => removeMapping(idx)}
                      className="text-red-500 hover:text-red-700 shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <VariablePickerInput
                    placeholder="Źródło (np. klient.wiek)"
                    className="w-full text-xs p-1.5 border rounded"
                    value={m.source}
                    onChange={(value) => updateMapping(idx, 'source', value)}
                    availableSchemas={availableSchemas}
                    disabled={isReadOnly}
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Docelowy klucz (np. age)"
                      className="w-2/3 text-xs p-1.5 border rounded"
                      value={m.target}
                      onChange={(e) => updateMapping(idx, 'target', e.target.value)}
                    />
                    <select
                      className="w-1/3 text-xs p-1.5 border rounded bg-white"
                      value={m.type}
                      onChange={(e) => updateMapping(idx, 'type', e.target.value)}
                    >
                      <option value="string">Tekst</option>
                      <option value="int">Liczba</option>
                      <option value="bool">Bool</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={addMapping}
              className="w-full py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-md hover:bg-primary/5"
            >
              + Dodaj mapowanie
            </button>
          </div>
        );
      }

      // Formularz akceptacji manualnej przez uytkownika
      case 'manual_approval':
        return (
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <h4 className="text-sm font-semibold text-amber-800 mb-2">
                Oczekiwanie na decyzję
              </h4>
              <p className="text-xs text-amber-700 leading-relaxed">
                Kiedy proces dotrze do tego klocka, zostanie trwale wstrzymany. Aby puścić
                go dalej, należy przejść do zakładki <b>Moje Procesy</b> i kliknąć zieloną
                ikonkę "Akceptuj" obok danego procesu.
              </p>
            </div>
          </div>
        );

      default:
        return (
          <p className="text-sm text-muted-foreground text-center mt-8">
            Brak dodatkowych opcji konfiguracji dla tego klocka.
          </p>
        );
    }
  };

  useEffect(() => {
    const loadCollections = async () => {
      try {
        const data = await listCollections();
        setCollections(data);
      } catch (error) {
        console.error('Błąd pobierania kolekcji:', error);
      }
    };
    void loadCollections();
  }, []);

  useEffect(() => {
    setNodePanelTab('config');
    setTestError(null);
    setTestResultJson('');
  }, [selectedNodeId]);

  useEffect(() => {
    if (!workflowId) {
      setLoadedWorkflowName('Nowy Workflow');
      setSavedWorkflowId(null);
      setIsReadOnly(false);
      setNodes([]);
      setEdges([]);
      setSelectedNodeId(null);
      return;
    }

    const wf = workflows.find((w) => w.id === workflowId) || null;
    if (!wf) {
      setLoadedWorkflowName('Nie znaleziono procesu');
      setSavedWorkflowId(workflowId);
      setIsReadOnly(true);
      setNodes([]);
      setEdges([]);
      setSelectedNodeId(null);
      return;
    }

    setLoadedWorkflowName(wf.name);
    setSavedWorkflowId(wf.id);
    setIsReadOnly(Boolean(wf.is_active));

    const loadedNodes: Node[] = (wf.graph_json?.nodes ?? []).map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: {
        ...n.data,
        config: (n.data?.config ?? {}) as any,
        description: (n.data as any)?.description ?? (n.data as any)?.label ?? 'Węzeł',
      },
    }));
    const loadedEdges: Edge[] = (wf.graph_json?.edges ?? []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      animated: true,
    }));

    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setSelectedNodeId(null);

    const maxNodeIndex = loadedNodes
      .map((n) => {
        const m = /^node_(\d+)$/.exec(n.id);
        return m ? Number(m[1]) : -1;
      })
      .reduce((acc, v) => Math.max(acc, v), -1);
    if (maxNodeIndex >= 0) {
      id = maxNodeIndex + 1;
    }
  }, [workflowId, workflows, setEdges, setNodes]);

  return (
    <div className="flex-1 flex flex-col bg-muted/30 h-full overflow-hidden">
      <header className="bg-white border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Powrót
          </button>
          <div className="h-6 w-px bg-border" />
          <h2 className="text-lg font-medium text-foreground">{loadedWorkflowName}</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={isReadOnly}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground bg-white border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            Zapisz
          </button>
          <button
            onClick={handleTest}
            disabled={isReadOnly}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground bg-white border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Play className="w-4 h-4" />
            Testuj
          </button>
          <button
            onClick={handlePublish}
            disabled={isReadOnly}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Upload className="w-4 h-4" />
            Publikuj
          </button>
        </div>
      </header>

      {isReadOnly && (
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 text-amber-900">
          <p className="text-sm font-semibold">
            Proces jest obecnie URUCHOMIONY. Przejdź do zakładki Moje Procesy i zatrzymaj
            go (Stop), aby odblokować możliwość edycji grafu.
          </p>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {!isReadOnly && (
          <aside className="w-72 bg-white border-r border-border overflow-y-auto shrink-0 h-full relative z-10">
            <div className="p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
                Przeciągnij na płótno
              </p>
              {nodeBlocks.map((block) => (
                <div key={block.category} className="mb-6">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    {block.category}
                  </h3>
                  <div className="space-y-2">
                    {block.items.map((item) => {
                      const Icon = item.icon;
                      const bgColors = {
                        trigger:
                          'bg-trigger-light border-trigger/30 hover:border-trigger/50',
                        logic: 'bg-logic-light border-logic/30 hover:border-logic/50',
                        action: 'bg-action-light border-action/30 hover:border-action/50',
                      };
                      const iconColors = {
                        trigger: 'text-trigger',
                        logic: 'text-logic',
                        action: 'text-action',
                      };
                      return (
                        <div
                          key={item.label}
                          className={`p-3 border rounded-lg cursor-grab transition-colors ${bgColors[item.type as keyof typeof bgColors]}`}
                          onDragStart={(e) =>
                            onDragStart(
                              e,
                              item.type,
                              item.subtype,
                              item.label,
                              item.description
                            )
                          }
                          draggable
                        >
                          <div className="flex items-center gap-2">
                            <Icon
                              className={`w-4 h-4 ${iconColors[item.type as keyof typeof iconColors]}`}
                            />
                            <span className="text-sm font-medium text-foreground">
                              {item.label}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 ml-6">
                            {item.description}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}

        <div className="flex-1 relative h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={handleSelectionChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            isValidConnection={isValidConnection}
            nodesDraggable={!isReadOnly}
            nodesConnectable={!isReadOnly}
            fitView
            defaultEdgeOptions={{
              style: { strokeWidth: 2, stroke: '#94a3b8' },
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#cbd5e1"
            />
            <Controls />
          </ReactFlow>

          {selectedNode && (
            <aside className="w-80 bg-white border-l border-border flex flex-col absolute right-0 top-0 bottom-0 z-10 shadow-2xl transition-all">
              <div className="px-4 py-4 border-b border-border flex justify-between items-center bg-muted/20 shrink-0">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Panel Węzła</h3>
                </div>
                <button
                  onClick={() => setSelectedNodeId(null)}
                  className="text-muted-foreground hover:text-red-500 p-1 rounded-md transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 border-b border-border bg-muted/10 shrink-0">
                <p className="text-xs font-semibold text-primary uppercase tracking-wider">
                  {selectedNode.data.label as string}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  ID klocka: {selectedNode.id}
                </p>
              </div>

              <div className="px-4 pt-3 border-b border-border bg-white shrink-0">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setNodePanelTab('config')}
                    className={`px-3 py-2 text-xs font-semibold rounded-md border transition-colors ${
                      nodePanelTab === 'config'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-white text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    Konfiguracja
                  </button>
                  <button
                    onClick={() => setNodePanelTab('test')}
                    className={`px-3 py-2 text-xs font-semibold rounded-md border transition-colors ${
                      nodePanelTab === 'test'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-white text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    Testuj Węzeł
                  </button>
                </div>
              </div>

              <div className="p-4 flex-1 overflow-y-auto">
                {nodePanelTab === 'config' ? (
                  <div className={isReadOnly ? 'opacity-60 pointer-events-none' : ''}>
                    {renderConfigForm()}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-foreground">
                        Input JSON
                      </label>
                      <textarea
                        className="mt-2 w-full min-h-[200px] rounded-md border border-border bg-white p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                        value={testInputJson}
                        onChange={(event) => setTestInputJson(event.target.value)}
                        placeholder='{\n  "foo": "bar"\n}'
                      />
                    </div>

                    <button
                      onClick={handleTestSelectedNode}
                      disabled={isNodeTestRunning}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <Zap className="w-4 h-4" />
                      {isNodeTestRunning ? 'Testowanie...' : 'Uruchom test węzła'}
                    </button>

                    {testError && (
                      <pre className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 whitespace-pre-wrap break-words">
                        {testError}
                      </pre>
                    )}

                    <div>
                      <label className="text-sm font-medium text-foreground">
                        Odpowiedź
                      </label>
                      <pre className="mt-2 min-h-[140px] rounded-md border border-border bg-muted/30 p-3 font-mono text-xs text-foreground whitespace-pre-wrap break-words">
                        {testResultJson || 'Brak odpowiedzi — uruchom test.'}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
