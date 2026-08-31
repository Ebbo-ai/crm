import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus, AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";

interface BrokerFirm {
  name: string;
  clientCount: number;
}

/**
 * Reduce a firm name to something comparable, for near-duplicate detection only.
 *
 * Never used to rewrite a stored value or to merge two firms. Deciding that
 * "Totem" and "Totem Solutions" are the same firm is a human call; all this does is
 * put the question in front of the operator before a third variant is created.
 */
function normalizeFirm(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'"\-\/]/g, " ")
    .replace(/\b(inc|llc|lp|llp|ltd|co|corp|corporation|company|group|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Firms already on file that the typed name is plausibly a variant of. */
function findNearMatches(typed: string, firms: BrokerFirm[]): BrokerFirm[] {
  const candidate = normalizeFirm(typed);
  if (candidate.length < 3) return [];
  return firms.filter(firm => {
    const existing = normalizeFirm(firm.name);
    if (!existing) return false;
    if (existing === candidate) return true;
    // One name sitting inside the other is the exact shape of this problem:
    // "Totem" inside "Totem Solutions", "Gallagher" inside "Gallagher international".
    return existing.includes(candidate) || candidate.includes(existing);
  });
}

interface BrokerFirmSelectProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  testId?: string;
}

/**
 * Pick a brokerage firm from the firms already on file, or deliberately add a new one.
 *
 * Free text is what produced "Totem Benefits", "Totem" and "Totem Solutions" as three
 * separate brokers, so typing alone cannot create a firm here: adding one takes an
 * explicit choice, a typed name, and a confirmation past any near-match warning.
 */
export function BrokerFirmSelect({
  value, onChange, id, placeholder = "Select brokerage firm", testId = "select-broker-firm",
}: BrokerFirmSelectProps) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const { data: firms = [], isLoading } = useQuery<BrokerFirm[]>({
    queryKey: ["/api/broker-firms"],
    queryFn: () => fetch("/api/broker-firms", { credentials: "include" }).then(r => (r.ok ? r.json() : [])),
  });

  // A firm the client already carries that is not in the list (a legacy spelling, or
  // one only this client uses) must still show as selected, or opening the picker to
  // change something else would look like the firm had been cleared.
  const options = useMemo(() => {
    const current = value.trim();
    if (!current || firms.some(f => f.name.toLowerCase() === current.toLowerCase())) return firms;
    return [...firms, { name: current, clientCount: 0 }]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [firms, value]);

  const nearMatches = useMemo(
    () => (draft.trim() ? findNearMatches(draft.trim(), firms) : []),
    [draft, firms],
  );

  const closeAll = () => {
    setOpen(false);
    setAdding(false);
    setDraft("");
  };

  const choose = (name: string) => {
    onChange(name);
    closeAll();
  };

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) { setAdding(false); setDraft(""); }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={testId}
        >
          <span className={value ? "text-foreground truncate" : "text-muted-foreground truncate"}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {adding ? (
          <div className="p-3 space-y-3" data-testid="panel-add-broker-firm">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1 text-xs"
                onClick={() => { setAdding(false); setDraft(""); }}
                data-testid="button-cancel-new-firm"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to list
              </Button>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="new-firm-name">
                New brokerage firm
              </label>
              <Input
                id="new-firm-name"
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="Full firm name"
                data-testid="input-new-broker-firm"
              />
              <p className="text-xs text-muted-foreground">
                Use the firm's full name as it appears on their paperwork. It becomes an option
                for every client from now on.
              </p>
            </div>

            {nearMatches.length > 0 && (
              <div
                className="rounded-md border border-warning/40 bg-warning/10 p-2.5 space-y-2"
                data-testid="warning-near-duplicate-firm"
              >
                <p className="text-xs text-warning-strong flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  <span>
                    {nearMatches.length === 1 ? "A similar firm is" : "Similar firms are"} already on
                    file. Adding this would create a second entry for what may be one firm.
                  </span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {nearMatches.map(match => (
                    <Button
                      key={match.name}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => choose(match.name)}
                      data-testid={`button-use-existing-${match.name}`}
                    >
                      Use "{match.name}"
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                disabled={!draft.trim()}
                onClick={() => choose(draft.trim())}
                data-testid="button-confirm-new-firm"
              >
                {nearMatches.length > 0 ? "Add anyway" : "Add firm"}
              </Button>
            </div>
          </div>
        ) : (
          <Command>
            <CommandInput placeholder="Search brokerage firms…" data-testid="input-search-broker-firm" />
            <CommandList>
              <CommandEmpty>
                {isLoading ? "Loading firms…" : "No firm on file matches that."}
              </CommandEmpty>
              <CommandGroup>
                {options.map(firm => (
                  <CommandItem
                    key={firm.name}
                    value={firm.name}
                    onSelect={() => choose(firm.name)}
                    data-testid={`option-broker-firm-${firm.name}`}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${
                        value.toLowerCase() === firm.name.toLowerCase() ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <span className="flex-1 truncate">{firm.name}</span>
                    {firm.clientCount > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground shrink-0">
                        {firm.clientCount} {firm.clientCount === 1 ? "client" : "clients"}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  onSelect={() => { setAdding(true); setDraft(""); }}
                  data-testid="option-add-broker-firm"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add new brokerage firm
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
