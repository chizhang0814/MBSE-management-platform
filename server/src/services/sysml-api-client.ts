/**
 * SysML v2 REST API 客户端
 *
 * 与 SysML v2 API Services (http://localhost:9000) 通信。
 * 使用 Node 内置 fetch，无额外依赖。
 */

// ── 类型 ──────────────────────────────────────────────────

export interface SysmlProject {
  '@id': string;
  '@type'?: string;
  name: string;
  description?: string;
}

export interface SysmlCommit {
  '@id': string;
  '@type': string;
}

export interface SysmlElement {
  '@id': string;
  '@type': string;
  name?: string;
  [key: string]: any;
}

export interface DataVersion {
  '@type': 'DataVersion';
  payload: SysmlElement | null;
  identity?: { '@id': string };
}

export interface CommitPayload {
  '@type': 'Commit';
  change: DataVersion[];
  previousCommit?: { '@id': string } | null;
}

// ── 错误 ──────────────────────────────────────────────────

export class SysmlApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: string,
  ) {
    super(message);
    this.name = 'SysmlApiError';
  }
}

// ── 客户端 ────────────────────────────────────────────────

export class SysmlApiClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl?: string, timeoutMs?: number) {
    this.baseUrl = (baseUrl || process.env.SYSML_API_URL || 'http://localhost:9000')
      .replace(/\/+$/, '');
    this.timeout = timeoutMs || 30_000;
  }

  // ── 内部 ──

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new SysmlApiError(
          `SysML API ${method} ${path}: ${res.status}`,
          res.status,
          text,
        );
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await res.json()) as T;
      }
      return (await res.text()) as unknown as T;
    } catch (err) {
      if (err instanceof SysmlApiError) throw err;
      throw new SysmlApiError(
        `SysML API unreachable: ${(err as Error).message}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // ── 公开 API ──

  /** 检测 SysML v2 API 是否可用 */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request('GET', '/projects?page[size]=1');
      return true;
    } catch {
      return false;
    }
  }

  /** 创建项目 */
  async createProject(name: string, description?: string): Promise<SysmlProject> {
    return this.request<SysmlProject>('POST', '/projects', {
      '@type': 'Project',
      name,
      description: description || `EICD project: ${name}`,
    });
  }

  /** 获取项目（不存在返回 null） */
  async getProject(projectId: string): Promise<SysmlProject | null> {
    try {
      return await this.request<SysmlProject>('GET', `/projects/${projectId}`);
    } catch (err) {
      if (err instanceof SysmlApiError && err.statusCode === 404) return null;
      throw err;
    }
  }

  /** 列出项目 */
  async listProjects(): Promise<SysmlProject[]> {
    return this.request<SysmlProject[]>('GET', '/projects');
  }

  /** 创建 commit（包含元素变更） */
  async createCommit(
    projectId: string,
    changes: DataVersion[],
    previousCommitId?: string | null,
  ): Promise<SysmlCommit> {
    const payload: CommitPayload = {
      '@type': 'Commit',
      change: changes,
    };
    if (previousCommitId) {
      payload.previousCommit = { '@id': previousCommitId };
    }
    return this.request<SysmlCommit>(
      'POST',
      `/projects/${projectId}/commits`,
      payload,
    );
  }

  /** 获取指定 commit 的元素列表 */
  async getElements(projectId: string, commitId: string): Promise<SysmlElement[]> {
    return this.request<SysmlElement[]>(
      'GET',
      `/projects/${projectId}/commits/${commitId}/elements`,
    );
  }

  /** 列出项目的 commits */
  async listCommits(projectId: string): Promise<SysmlCommit[]> {
    return this.request<SysmlCommit[]>(
      'GET',
      `/projects/${projectId}/commits`,
    );
  }
}
