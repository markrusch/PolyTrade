import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type {
  ParquetQueryResult,
  ParquetTable,
  ParquetExample,
} from '../../lib/api';

export function SqlQueryPanel() {
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<ParquetQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);

  // Fetch data status
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['parquet-status'],
    queryFn: () => api.getParquetStatus(),
    refetchInterval: 30000,
  });

  // Fetch example queries
  const { data: examples } = useQuery({
    queryKey: ['parquet-examples'],
    queryFn: () => api.getParquetExamples(),
  });

  // Execute query mutation
  const queryMutation = useMutation({
    mutationFn: (querySql: string) => api.executeParquetQuery(querySql),
    onSuccess: (data) => {
      setResult(data.data);
      setError(null);
      // Add to history (dedup)
      setQueryHistory(prev => {
        const cleaned = prev.filter(q => q !== sql);
        return [sql, ...cleaned].slice(0, 20);
      });
    },
    onError: (err: Error) => {
      setError(err.message);
      setResult(null);
    },
  });

  const executeQuery = useCallback(() => {
    if (!sql.trim()) return;
    queryMutation.mutate(sql.trim());
  }, [sql, queryMutation]);

  const loadExample = useCallback((example: ParquetExample) => {
    setSql(example.sql);
    setError(null);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl+Enter or Cmd+Enter to execute
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      executeQuery();
    }
  }, [executeQuery]);

  const tables: ParquetTable[] = status?.data?.tables || [];
  const dataExists = status?.data?.dataExists || false;
  const totalRows = status?.data?.totalRows || 0;

  return (
    <div className="sql-query-panel">
      {/* Header */}
      <div className="sql-header">
        <h2>Historic Data Explorer</h2>
        <p className="sql-subtitle">
          Query Polymarket &amp; Kalshi historic data with SQL (powered by DuckDB)
        </p>
        <div className="sql-data-status">
          {statusLoading ? (
            <span className="status-badge loading">Loading...</span>
          ) : dataExists ? (
            <span className="status-badge ready">
              {tables.length} tables | {totalRows.toLocaleString()} rows
            </span>
          ) : (
            <span className="status-badge not-ready">
              Data not downloaded. Run: python scripts/download-research-data.py
            </span>
          )}
        </div>
      </div>

      {/* Tables sidebar */}
      <div className="sql-layout">
        <div className="sql-sidebar">
          <h3>Tables</h3>
          {tables.length === 0 ? (
            <div className="sql-no-tables">
              <p>No tables available.</p>
              <p className="sql-hint">Download data first:</p>
              <code>python scripts/download-research-data.py</code>
            </div>
          ) : (
            <div className="sql-table-list">
              {tables.map((table) => (
                <div
                  key={table.name}
                  className={`sql-table-item ${selectedTable === table.name ? 'selected' : ''}`}
                  onClick={() => setSelectedTable(selectedTable === table.name ? null : table.name)}
                >
                  <div className="sql-table-name">{table.name}</div>
                  <div className="sql-table-meta">
                    {table.rowCount ? `${table.rowCount.toLocaleString()} rows` : 'loading...'}
                  </div>
                  {selectedTable === table.name && (
                    <div className="sql-table-columns">
                      {table.columns.map((col) => (
                        <div key={col.name} className="sql-column-item">
                          <span className="sql-col-name">{col.name}</span>
                          <span className="sql-col-type">{col.type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Example queries */}
          {examples?.data && examples.data.length > 0 && (
            <>
              <h3>Example Queries</h3>
              <div className="sql-examples">
                {examples.data.map((ex, i) => (
                  <button
                    key={i}
                    className="sql-example-btn"
                    onClick={() => loadExample(ex)}
                    title={ex.description}
                  >
                    {ex.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Query history */}
          {queryHistory.length > 0 && (
            <>
              <h3>History</h3>
              <div className="sql-history">
                {queryHistory.map((q, i) => (
                  <button
                    key={i}
                    className="sql-history-btn"
                    onClick={() => setSql(q)}
                    title={q}
                  >
                    {q.substring(0, 60)}{q.length > 60 ? '...' : ''}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Main editor area */}
        <div className="sql-main">
          {/* Query editor */}
          <div className="sql-editor-section">
            <div className="sql-editor-header">
              <span>SQL Query</span>
              <span className="sql-shortcut">Ctrl+Enter to execute</span>
            </div>
            <textarea
              className="sql-editor"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`SELECT * FROM kalshi_markets\nWHERE result IN ('yes', 'no')\nLIMIT 10`}
              spellCheck={false}
            />
            <div className="sql-actions">
              <button
                className="sql-run-btn"
                onClick={executeQuery}
                disabled={queryMutation.isPending || !sql.trim()}
              >
                {queryMutation.isPending ? 'Running...' : 'Run Query'}
              </button>
              <button
                className="sql-clear-btn"
                onClick={() => { setSql(''); setResult(null); setError(null); }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="sql-error">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="sql-results-section">
              <div className="sql-results-header">
                <span>
                  {result.rowCount} row{result.rowCount !== 1 ? 's' : ''}
                  {result.truncated && ' (truncated to 1000)'}
                </span>
                <span className="sql-timing">{result.executionTimeMs}ms</span>
              </div>
              <div className="sql-results-table-wrapper">
                <table className="sql-results-table">
                  <thead>
                    <tr>
                      {result.columns.map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i}>
                        {result.columns.map((col) => (
                          <td key={col}>{formatCell(row[col])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const str = String(value);
  if (str.length > 200) return str.substring(0, 200) + '...';
  return str;
}
