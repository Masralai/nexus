import type { EngineEvent, Tool } from "../engine/types"

export interface PluginContext {
  cwd: string
  sessionId?: string
}

/**
 * Deliberately small plugin seam. Loaders and remote packages are out of scope
 * for M1; this fixes the shape without adopting an external plugin runtime.
 */
export interface PluginHooks {
  name: string
  /** Contribute new tools. Wrapping still runs over the combined registry. */
  registerTools?: (ctx: PluginContext) => Tool[]
  /** Wrap, replace, or hide tools. Return undefined to remove a tool. */
  tool?: (tool: Tool, ctx: PluginContext) => Tool | undefined
  /** Mutate provider request params (temperature, options) before a call. */
  chatParams?: (params: Record<string, unknown>, ctx: PluginContext) => Record<string, unknown> | void
  /** Observe engine events. Must not throw into the turn loop. */
  event?: (event: EngineEvent, ctx: PluginContext) => void
  /** Observe permission decisions; cannot override a deny. */
  permission?: (req: { name: string; input: unknown; granted: boolean }, ctx: PluginContext) => void
  /** Register an auth method for a provider. Loader ships in M5. */
  auth?: (provider: string) => { apiKey?: string } | undefined
}

export class PluginRegistry {
  private plugins: PluginHooks[] = []

  use(plugin: PluginHooks): this {
    this.plugins.push(plugin)
    return this
  }

  list(): readonly PluginHooks[] {
    return this.plugins
  }

  tools(tools: readonly Tool[], ctx: PluginContext): Tool[] {
    let out = [...tools]
    for (const plugin of this.plugins) {
      if (!plugin.registerTools) continue
      try {
        out.push(...plugin.registerTools(ctx))
      } catch {
        /* one plugin must not remove the whole tool set */
      }
    }
    for (const plugin of this.plugins) {
      if (!plugin.tool) continue
      out = out
        .map((tool) => {
          try {
            return plugin.tool!(tool, ctx)
          } catch {
            // Keep the unwrapped tool when a wrapper fails.
            return tool
          }
        })
        .filter((tool): tool is Tool => tool !== undefined)
    }
    return out
  }

  /** Last registered auth provider wins; BYOK resolution still takes precedence. */
  auth(provider: string): { apiKey?: string } | undefined {
    let out: { apiKey?: string } | undefined
    for (const plugin of this.plugins) {
      try {
        const next = plugin.auth?.(provider)
        if (next) out = next
      } catch {
        /* ignore an auth hook that throws */
      }
    }
    return out
  }

  chatParams(params: Record<string, unknown>, ctx: PluginContext): Record<string, unknown> {
    let out = { ...params }
    for (const plugin of this.plugins) {
      if (!plugin.chatParams) continue
      try {
        const next = plugin.chatParams(out, ctx)
        if (next) out = next
      } catch {
        /* ignore a broken parameter hook */
      }
    }
    return out
  }

  emit(event: EngineEvent, ctx: PluginContext): void {
    for (const plugin of this.plugins) {
      try {
        plugin.event?.(event, ctx)
      } catch {
        /* plugin failures never break a turn */
      }
    }
  }

  permission(req: { name: string; input: unknown; granted: boolean }, ctx: PluginContext): void {
    for (const plugin of this.plugins) {
      try {
        plugin.permission?.(req, ctx)
      } catch {
        /* ignore */
      }
    }
  }
}
