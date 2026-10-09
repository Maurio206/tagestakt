"use client";

import {
  SLOT_REQUIREMENTS,
  SLOT_REQUIREMENT_LABELS,
  type SlotRequirement,
  WEEKDAY_LABELS,
} from "@tagestakt/schedule-schema";
import { useActionState } from "react";

import { type ActionState, type FormAction, initialActionState } from "@/lib/form";

import { Field, FormMessage, SubmitButton, fieldProps, valueAfterError } from "./ui";

/** Leere Felder = noch nicht festgelegt. Der Planer rät keine Werte. */
export interface PlanningRulesDefaults {
  businessEarliestStart: string;
  businessLatestEnd: string;
  businessMinBlockMinutes: string;
  businessMaxBlockMinutes: string;
  businessMaxDailyMinutes: string;
  businessSaturdayMaxMinutes: string;
  businessSundayMaxMinutes: string;
  bufferMinutes: string;
}

const RULE_FIELDS: readonly {
  name: keyof PlanningRulesDefaults;
  id: string;
  label: string;
  type: "time" | "minutes";
  hint?: string;
}[] = [
  {
    name: "businessEarliestStart",
    id: "regel-beginn",
    label: "Gewerbe frühestens ab",
    type: "time",
  },
  { name: "businessLatestEnd", id: "regel-ende", label: "Gewerbe spätestens bis", type: "time" },
  {
    name: "businessMinBlockMinutes",
    id: "regel-block-min",
    label: "Gewerbeblock mindestens (Minuten)",
    type: "minutes",
  },
  {
    name: "businessMaxBlockMinutes",
    id: "regel-block-max",
    label: "Gewerbeblock höchstens (Minuten)",
    type: "minutes",
  },
  {
    name: "businessMaxDailyMinutes",
    id: "regel-tag-max",
    label: "Gewerbe je Werktag höchstens (Minuten)",
    type: "minutes",
    hint: "Montag bis Freitag.",
  },
  {
    name: "businessSaturdayMaxMinutes",
    id: "regel-samstag",
    label: "Gewerbe am Samstag höchstens (Minuten)",
    type: "minutes",
    hint: "0 = kein Gewerbe am Samstag.",
  },
  {
    name: "businessSundayMaxMinutes",
    id: "regel-sonntag",
    label: "Gewerbe am Sonntag höchstens (Minuten)",
    type: "minutes",
    hint: "0 = kein Gewerbe am Sonntag.",
  },
  {
    name: "bufferMinutes",
    id: "regel-pause",
    label: "Pause zwischen Blöcken (Minuten)",
    type: "minutes",
  },
];

export function PlanningRulesForm({
  action,
  defaults,
}: {
  action: FormAction;
  defaults: PlanningRulesDefaults;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="stack" noValidate>
      <FormMessage state={state} />
      <div className="form-grid">
        {RULE_FIELDS.map((field) => (
          <Field
            key={field.name}
            label={field.label}
            id={field.id}
            name={field.name}
            state={state}
            hint={field.hint}
          >
            <input
              {...fieldProps(state, field.id, field.name, Boolean(field.hint))}
              type={field.type === "time" ? "time" : "text"}
              inputMode={field.type === "minutes" ? "numeric" : undefined}
              placeholder={field.type === "minutes" ? "Minuten" : undefined}
              defaultValue={valueAfterError(state, field.name, defaults[field.name])}
            />
          </Field>
        ))}
      </div>
      <div className="button-row">
        <SubmitButton>Planungsregeln speichern</SubmitButton>
      </div>
    </form>
  );
}

export interface GoalSlotDefaults {
  weekday: number;
  active: boolean;
  requirement: SlotRequirement;
  title: string;
  duration: string;
  start: string;
  end: string;
}

function slotValue(state: ActionState, name: string, fallback: string): string {
  return valueAfterError(state, name, fallback);
}

/** Zeitfenster je Wochentag: verbindlich oder optional, Dauer und frühester/spätester Zeitpunkt. */
export function GoalSlotsForm({
  action,
  goalLabel,
  idPrefix,
  slots,
}: {
  action: FormAction;
  goalLabel: string;
  idPrefix: string;
  slots: readonly GoalSlotDefaults[];
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const afterError = state.status === "error" && state.values ? state.values : undefined;
  const formKey = afterError ? JSON.stringify(afterError) : "standard";
  return (
    <form key={formKey} action={formAction} className="stack" noValidate>
      <FormMessage state={state} />
      <ul className="list slot-list">
        {slots.map((slot) => {
          const base = `slot-${slot.weekday}`;
          const id = `${idPrefix}-${slot.weekday}`;
          const active = afterError ? afterError[`${base}-active`] === "on" : slot.active;
          return (
            <li key={slot.weekday} className="slot-row">
              <div className="check slot-day">
                <input
                  id={`${id}-aktiv`}
                  name={`${base}-active`}
                  type="checkbox"
                  defaultChecked={active}
                />
                <label htmlFor={`${id}-aktiv`}>
                  {goalLabel} am {WEEKDAY_LABELS[slot.weekday as keyof typeof WEEKDAY_LABELS]}
                </label>
              </div>
              <div className="form-grid slot-fields">
                <Field
                  label="Pflicht"
                  id={`${id}-pflicht`}
                  name={`${base}-requirement`}
                  state={state}
                >
                  <select
                    {...fieldProps(state, `${id}-pflicht`, `${base}-requirement`)}
                    defaultValue={slotValue(state, `${base}-requirement`, slot.requirement)}
                  >
                    {SLOT_REQUIREMENTS.map((requirement) => (
                      <option key={requirement} value={requirement}>
                        {SLOT_REQUIREMENT_LABELS[requirement]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Titel im Plan"
                  id={`${id}-titel`}
                  name={`${base}-title`}
                  state={state}
                >
                  <input
                    {...fieldProps(state, `${id}-titel`, `${base}-title`)}
                    defaultValue={slotValue(state, `${base}-title`, slot.title)}
                    maxLength={120}
                  />
                </Field>
                <Field
                  label="Dauer (Minuten)"
                  id={`${id}-dauer`}
                  name={`${base}-duration`}
                  state={state}
                >
                  <input
                    {...fieldProps(state, `${id}-dauer`, `${base}-duration`)}
                    inputMode="numeric"
                    placeholder="Minuten"
                    defaultValue={slotValue(state, `${base}-duration`, slot.duration)}
                  />
                </Field>
                <Field label="Frühestens ab" id={`${id}-von`} name={`${base}-start`} state={state}>
                  <input
                    {...fieldProps(state, `${id}-von`, `${base}-start`)}
                    type="time"
                    defaultValue={slotValue(state, `${base}-start`, slot.start)}
                  />
                </Field>
                <Field label="Spätestens bis" id={`${id}-bis`} name={`${base}-end`} state={state}>
                  <input
                    {...fieldProps(state, `${id}-bis`, `${base}-end`)}
                    type="time"
                    defaultValue={slotValue(state, `${base}-end`, slot.end)}
                  />
                </Field>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="button-row">
        <SubmitButton>Zeitfenster speichern</SubmitButton>
      </div>
    </form>
  );
}
