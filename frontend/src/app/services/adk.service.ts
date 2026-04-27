import { API_BASE_URL } from '../config';

export class AdkService {
  // use centralized base URL
  private readonly baseUrl = API_BASE_URL;

  /**
   * Send a message to the ADK REST API. If `accessToken` is provided,
   * it will be sent as a Bearer token in the Authorization header.
   */
  public async sendMessage(
    message: string,
    accessToken?: string,
    userId?: string | null,
    sessionId?: string | null,
    signal?: AbortSignal
  ): Promise<any> {
    const params = new URLSearchParams();
    params.append('query', message);
    if (userId) params.append('userId', userId);
    if (sessionId) params.append('sessionId', sessionId);
    const url = `${this.baseUrl}/query?${params.toString()}`; // adjust path to your ADK API
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const resp = await fetch(url, {
        method: 'GET',
        headers,
        signal,
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`${resp.status} ${text}`);
      }
      const data = await resp.json();
      // return full payload so caller can access response and tasks
      return data;
    } catch (e) {
      throw e;
    }
  }
}
