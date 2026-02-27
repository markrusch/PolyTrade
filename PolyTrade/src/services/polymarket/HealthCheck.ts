import axios from 'axios';

export interface HealthStatus {
  timestamp: Date;
  dataApi: {
    status: 'healthy' | 'unhealthy' | 'unknown';
    message?: string;
    responseTime?: number;
  };
  clob: {
    status: 'healthy' | 'unhealthy' | 'unknown';
    message?: string;
    responseTime?: number;
  };
  gamma: {
    status: 'healthy' | 'unhealthy' | 'unknown';
    message?: string;
    responseTime?: number;
  };
}

export class HealthCheckService {
  private readonly dataApiUrl = 'https://data-api.polymarket.com';
  private readonly clobUrl = 'https://clob.polymarket.com';
  private readonly gammaUrl = 'https://gamma-api.polymarket.com';

  async checkDataApi(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime: number; message?: string }> {
    const startTime = Date.now();
    try {
      const response = await axios.get(`${this.dataApiUrl}/`, { timeout: 5000 });
      const responseTime = Date.now() - startTime;

      if (response.data?.data === 'OK' || response.status === 200) {
        return { status: 'healthy', responseTime };
      } else {
        return {
          status: 'unhealthy',
          responseTime,
          message: 'Unexpected response format',
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        status: 'unhealthy',
        responseTime,
        message: (error as any).message || 'Request failed',
      };
    }
  }

  async checkClob(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime: number; message?: string }> {
    const startTime = Date.now();
    try {
      // Try to fetch a simple endpoint like /price
      const response = await axios.get(`${this.clobUrl}/price`, {
        params: { token_id: '1' }, // Dummy ID just to test connectivity
        timeout: 5000,
      });
      const responseTime = Date.now() - startTime;
      return { status: 'healthy', responseTime };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      // CLOB may reject the dummy request, but as long as we get a response, it's up
      if ((error as any).response?.status) {
        return { status: 'healthy', responseTime, message: 'API responding (request rejected as expected)' };
      }
      return {
        status: 'unhealthy',
        responseTime,
        message: (error as any).message || 'Request failed',
      };
    }
  }

  async checkGamma(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime: number; message?: string }> {
    const startTime = Date.now();
    try {
      const response = await axios.get(`${this.gammaUrl}/markets`, { timeout: 5000, params: { limit: 1 } });
      const responseTime = Date.now() - startTime;

      if (Array.isArray(response.data) || response.data?.markets) {
        return { status: 'healthy', responseTime };
      } else {
        return { status: 'healthy', responseTime, message: 'API responding' };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        status: 'unhealthy',
        responseTime,
        message: (error as any).message || 'Request failed',
      };
    }
  }

  async checkAll(): Promise<HealthStatus> {
    const [dataApi, clob, gamma] = await Promise.all([
      this.checkDataApi(),
      this.checkClob(),
      this.checkGamma(),
    ]);

    return {
      timestamp: new Date(),
      dataApi: {
        status: dataApi.status,
        message: dataApi.message,
        responseTime: dataApi.responseTime,
      },
      clob: {
        status: clob.status,
        message: clob.message,
        responseTime: clob.responseTime,
      },
      gamma: {
        status: gamma.status,
        message: gamma.message,
        responseTime: gamma.responseTime,
      },
    };
  }

  isHealthy(health: HealthStatus): boolean {
    return (
      health.dataApi.status === 'healthy' &&
      health.clob.status === 'healthy' &&
      health.gamma.status === 'healthy'
    );
  }

  formatStatus(health: HealthStatus): string {
    const overall = this.isHealthy(health) ? '✅ HEALTHY' : '⚠️  DEGRADED';
    return (
      `\n${overall}\n` +
      `Data API:  ${health.dataApi.status} (${health.dataApi.responseTime}ms) ${health.dataApi.message ? `- ${health.dataApi.message}` : ''}\n` +
      `CLOB:      ${health.clob.status} (${health.clob.responseTime}ms) ${health.clob.message ? `- ${health.clob.message}` : ''}\n` +
      `Gamma:     ${health.gamma.status} (${health.gamma.responseTime}ms) ${health.gamma.message ? `- ${health.gamma.message}` : ''}\n`
    );
  }
}
