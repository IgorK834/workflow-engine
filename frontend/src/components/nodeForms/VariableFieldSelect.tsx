import { useEffect, useMemo, useRef, useState } from 'react';
import { Braces, Search } from 'lucide-react';
import type { AvailableVariable } from '../VariableInput';

type VariableFieldSelectProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  availableVariables: AvailableVariable[];
  className?: string;
  allowFreeText?: boolean;
};

export default function VariableFieldSelect({
  value,
  onChange,
  placeholder = 'Wybierz pole…',
  disabled,
  availableVariables,
  className,
  allowFreeText = true,
}: VariableFieldSelectProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? availableVariables.filter((v) => {
          const haystack = `${v.sourceNodeName} ${v.label} ${v.value}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        })
      : availableVariables;

    const groups = new Map<string, AvailableVariable[]>();
    filtered.forEach((v) => {
      const list = groups.get(v.sourceNodeName) ?? [];
      list.push(v);
      groups.set(v.sourceNodeName, list);
    });

    return Array.from(groups.entries()).map(([sourceNodeName, vars]) => ({
      sourceNodeName,
      vars,
    }));
  }, [availableVariables, query]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current) return;
      const target = event.target as Node | null;
      if (target && wrapperRef.current.contains(target)) return;
      setIsOpen(false);
      setQuery('');
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      setQuery('');
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          placeholder={placeholder}
          className={`${className ?? ''} pr-10`}
          value={value}
          onChange={(e) => {
            if (!allowFreeText) return;
            onChange(e.target.value);
          }}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          disabled={disabled}
          className="absolute right-2 top-2 inline-flex items-center justify-center p-1.5 rounded-md border border-border bg-white hover:bg-muted transition-colors disabled:opacity-50"
          title="Wybierz pole z danych"
        >
          <Braces className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-0 top-10 z-30 w-full max-h-80 overflow-hidden rounded-xl border border-border bg-white shadow-xl">
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 rounded-md border border-border bg-white px-2 py-1.5">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Szukaj pola…"
                className="w-full text-xs outline-none bg-transparent"
                autoFocus
              />
            </div>
          </div>

          <div className="p-2 max-h-64 overflow-y-auto">
            {grouped.length === 0 ? (
              <div className="px-2 py-6 text-xs text-muted-foreground text-center">
                Brak dostępnych pól.
              </div>
            ) : (
              <div className="space-y-2">
                {grouped.map((group) => (
                  <div
                    key={group.sourceNodeName}
                    className="rounded-lg border border-border/70 bg-muted/10"
                  >
                    <div className="px-2.5 py-2 border-b border-border/60 text-xs font-semibold truncate">
                      {group.sourceNodeName}
                    </div>
                    <div className="p-1.5">
                      {group.vars.map((v) => (
                        <button
                          key={`${group.sourceNodeName}:${v.value}`}
                          type="button"
                          onClick={() => {
                            onChange(v.value);
                            setIsOpen(false);
                            setQuery('');
                          }}
                          className="w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs hover:bg-muted transition-colors"
                          title={v.value}
                        >
                          <span className="truncate">{v.label}</span>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {v.value}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

