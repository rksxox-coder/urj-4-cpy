import React, { useState, useEffect, useRef } from 'react';
import mermaid from 'mermaid';
import { Layout, Input, Button, Table, Modal, Space, Select, Typography, Tooltip, Progress, ConfigProvider, theme, List, Descriptions, Collapse, Avatar, Card } from 'antd';
import { DownloadOutlined, BarChartOutlined, StopOutlined, RocketOutlined, SaveOutlined, GithubOutlined, LogoutOutlined, LinkOutlined, ThunderboltOutlined, SyncOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import './App.css';

const { Header, Content, Footer } = Layout;
const { TextArea } = Input;
const { Title, Text } = Typography;
const { Panel } = Collapse;

mermaid.initialize({ startOnLoad: false, theme: 'dark' });

// Custom hook to handle session timeout due to inactivity
function useIdleTimeout(onIdle, idleTime = 300000) { // Default timeout is 5 minutes
  const timeoutIdRef = useRef(null);

  useEffect(() => {
    // These functions are now defined inside the effect, so they don't need to be dependencies.
    const handleIdle = () => {
      onIdle();
    };

    const resetTimer = () => {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = setTimeout(handleIdle, idleTime);
    };

    const updateLastActivity = () => {
      const user = JSON.parse(localStorage.getItem('currentUser'));
      if (user) {
        user.lastActivity = Date.now();
        localStorage.setItem('currentUser', JSON.stringify(user));
      }
    };

    const eventHandler = () => {
      updateLastActivity();
      resetTimer();
    };

    // Set up the initial timer and event listeners
    resetTimer();
    const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
    events.forEach(event => window.addEventListener(event, eventHandler));

    // Cleanup function to remove timer and listeners
    return () => {
      clearTimeout(timeoutIdRef.current);
      events.forEach(event => window.removeEventListener(event, eventHandler));
    };
  }, [onIdle, idleTime]); // The dependencies are correct now
}

const LoginForm = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch("https://urj4.onrender.com/login", { // Your login endpoint
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok && data.user) {
        onLoginSuccess(data.user); // Pass the entire user object back on success
      } else {
        setError(data.detail || 'Invalid credentials.'); // Use 'detail' from FastAPI's HTTPException
      }
    } catch (err) {
      setError('Failed to connect to the server.');
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">🔗</div>
          <Title className="login-brand-title">URL Journey Analyzer</Title>
          <Text className="login-brand-subtitle">Trace every redirect. Understand the path.</Text>
        </div>

        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text className="login-field-label">Username</Text>
            <Input
              prefix={<span style={{ color: '#475569', marginRight: 4 }}>@</span>}
              placeholder="Enter your username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onPressEnter={handleLogin}
              size="large"
            />
          </div>

          <div>
            <Text className="login-field-label">Password</Text>
            <Input.Password
              placeholder="Enter your password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onPressEnter={handleLogin}
              size="large"
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 14px',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 8,
              color: '#f87171',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <Button
            className="login-btn"
            type="primary"
            onClick={handleLogin}
            loading={loading}
            icon={<RocketOutlined />}
            style={{ marginTop: 8 }}
          >
            Sign In
          </Button>
        </Space>
      </div>
    </div>
  );
};


function AnalyzerView({ currentUser, onLogout }) {
  useIdleTimeout(onLogout, 300000);
  const [urlsInput, setUrlsInput] = useState('');
  const [results, setResults] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [modalData, setModalData] = useState(null);
  const [savedScans, setSavedScans] = useState([]);
  const [progress, setProgress] = useState(0);
  const [totalUrls, setTotalUrls] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchInfo, setBatchInfo] = useState(null);
  const timerRef = useRef(null);
  const socketRef = useRef(null);
  const batchStopRef = useRef(false);
  const batchTimestampRef = useRef(null);


  const generateMermaidMarkup = (details) => {
    let markup = 'graph TD\n';
    const chain = details.redirectChain;
    if (!chain || chain.length === 0) {
      return `graph TD\n A["<b>${details.originalURL}</b><br/>${details.error ? `<span style='color:red'>Error: ${details.error}</span>` : 'No redirects.'}"];`;
    }
    chain.forEach((hop, index) => {
        const id = `hop${index}`;
        const nodeText = `"<b>${truncate(hop.url, 40)}</b><br/>Status: ${hop.status}<br/>Server: ${hop.server || 'Unknown'}"`;
        markup += `  ${id}[${nodeText}]`;
        if (index < chain.length - 1) markup += ` --> hop${index + 1};\n`;
    });
    return markup;
  };
  

  useEffect(() => {
    if (modalData) {
      const graphDiv = document.querySelector('.mermaid');
      if (graphDiv) {
        try {
            const markup = generateMermaidMarkup(modalData);
            // Use mermaid.render for more stability
            mermaid.render('theGraph', markup, (svgCode) => {
                graphDiv.innerHTML = svgCode;
            });
        } catch(e) {
            console.error("Mermaid rendering error:", e);
            graphDiv.innerHTML = "Could not render redirect graph.";
        }
      }
    }
  }, [modalData]);

  useEffect(() => { loadScanList(); }, []);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsedTime(0);
    timerRef.current = setInterval(() => { setElapsedTime(prev => prev + 1); }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const loadScanList = () => {
    const scans = Object.keys(localStorage).filter(k => k.startsWith('scan_')).map(k => ({ value: k, label: k.replace('scan_', '').replace(/_/g, ' ') }));
    setSavedScans(scans);
  };

 const handleAnalyze = () => {
    const urls = urlsInput.split('\n').filter(url => url.trim());

    // This is the new block that checks the user's limit
    const URL_LIMIT = currentUser.url_limit;
    if (urls.length > URL_LIMIT) {
      Modal.error({
        title: 'URL Limit Exceeded',
        content: `Your user role ('${currentUser.role}') allows a maximum of ${URL_LIMIT} URLs. You entered ${urls.length}.`,
      });
      return;
    }
    
    if (urls.length === 0) { 
        Modal.warning({ title: 'Input Required', content: 'Please enter at least one URL.' }); 
        return; 
    }

    setIsAnalyzing(true); 
    setResults([]); 
    setTotalUrls(urls.length); 
    setProgress(0); 
    startTimer();
    
    const socket = new WebSocket("wss://urj4.onrender.com/analyze");
    socketRef.current = socket;
    socket.onopen = () => socket.send(JSON.stringify({ urls }));
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.done) { 
        stopTimer(); 
        setIsAnalyzing(false); 
      } else { 
        setResults(prev => [...prev, data]); 
        setProgress(p => p + 1); 
      }
    };
    socket.onerror = () => { 
        Modal.error({ title: 'Connection Error', content: 'Could not connect to the backend.' }); 
        stopTimer(); 
        setIsAnalyzing(false); 
    };
    socket.onclose = () => { 
        setIsAnalyzing(false); 
    };
  };
  
  const handleStopAnalysis = () => {
    batchStopRef.current = true;
    if (socketRef.current) socketRef.current.close();
    if (!isBatchMode) {
      stopTimer();
      setIsAnalyzing(false);
    }
    // In batch mode, runBatchAnalysis loop detects batchStopRef and cleans up
  };

  // ── Batch Analysis Helpers ──────────────────────────────────────────────────

  const getValidUrlCount = (input) => input.split('\n').filter(url => url.trim()).length;

  const createBatches = (urls) => {
    const batches = [];
    let i = 0;
    while (i < urls.length) {
      const remaining = urls.length - i;
      if (remaining < 45) {
        batches.push(urls.slice(i));
        break;
      }
      const batchSize = Math.floor(Math.random() * 11) + 45; // 45–55
      batches.push(urls.slice(i, i + batchSize));
      i += batchSize;
    }
    return batches;
  };

  const processBatchWebSocket = (batchUrls, onResult) => {
    return new Promise((resolve) => {
      const batchResults = [];
      let resolved = false;
      const socket = new WebSocket("wss://urj4.onrender.com/analyze");
      socketRef.current = socket;

      socket.onopen = () => socket.send(JSON.stringify({ urls: batchUrls }));
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.done) {
          if (!resolved) { resolved = true; resolve({ results: batchResults, stopped: false }); }
        } else {
          batchResults.push(data);
          onResult(batchResults.length);
        }
      };
      socket.onerror = () => {
        if (!resolved) { resolved = true; resolve({ results: batchResults, stopped: false }); }
      };
      socket.onclose = () => {
        if (!resolved) { resolved = true; resolve({ results: batchResults, stopped: batchStopRef.current }); }
      };
    });
  };

  const runBatchAnalysis = async (batches, totalUrlCount) => {
    const timestamp = Date.now();
    batchTimestampRef.current = timestamp;
    batchStopRef.current = false;

    setIsBatchMode(true);
    setIsAnalyzing(true);
    setResults([]);
    setTotalUrls(totalUrlCount);
    setProgress(0);
    startTimer();

    let allResults = [];

    for (let i = 0; i < batches.length; i++) {
      if (batchStopRef.current) break;

      const batch = batches[i];
      setBatchInfo({
        currentBatch: i + 1,
        totalBatches: batches.length,
        batchUrls: batch.length,
        completedInBatch: 0,
        countdown: null,
        statusText: `Processing Batch ${i + 1} of ${batches.length}…`,
      });

      const { results: batchResults } = await processBatchWebSocket(batch, (completed) => {
        setProgress(p => p + 1);
        setBatchInfo(prev => prev ? { ...prev, completedInBatch: completed } : prev);
      });

      // Persist batch to localStorage for crash resilience
      const batchKey = `batch_${timestamp}_${i + 1}`;
      localStorage.setItem(batchKey, JSON.stringify(batchResults));

      allResults = [...allResults, ...batchResults];

      if (batchStopRef.current) break;

      // Countdown delay between batches (not after the last batch)
      if (i < batches.length - 1) {
        const delaySeconds = Math.floor(Math.random() * 6) + 5; // 5–10 s
        for (let s = delaySeconds; s > 0; s--) {
          if (batchStopRef.current) break;
          setBatchInfo(prev => prev ? {
            ...prev,
            countdown: s,
            statusText: `Waiting ${s}s before Batch ${i + 2}…`,
          } : prev);
          await new Promise(res => setTimeout(res, 1000));
        }
        if (!batchStopRef.current) {
          setBatchInfo(prev => prev ? { ...prev, countdown: null } : prev);
        }
      }
    }

    // Combine all batch results and clean up localStorage entries
    for (let i = 0; i < batches.length; i++) {
      localStorage.removeItem(`batch_${timestamp}_${i + 1}`);
    }

    setResults(allResults);
    stopTimer();
    setIsAnalyzing(false);
    setIsBatchMode(false);
    setBatchInfo(null);
  };

  const handleBatchAnalyze = () => {
    const urls = urlsInput.split('\n').filter(url => url.trim());
    if (urls.length === 0) {
      Modal.warning({ title: 'Input Required', content: 'Please enter at least one URL.' });
      return;
    }
    const urlLimit = currentUser.url_limit;
    if (urls.length > urlLimit) {
      Modal.error({
        title: 'URL Limit Exceeded',
        content: `Your user role ('${currentUser.role}') allows a maximum of ${urlLimit} URLs. You entered ${urls.length}.`,
      });
      return;
    }
    const batches = createBatches(urls);
    Modal.confirm({
      title: '🔄 Batch Analysis',
      content: `${urls.length} URL${urls.length !== 1 ? 's' : ''} will be split into ${batches.length} batch${batches.length !== 1 ? 'es' : ''} of 45–55 URLs each, with a random 5–10 second delay between batches.`,
      okText: 'Start Batch Analysis',
      cancelText: 'Cancel',
      onOk: () => runBatchAnalysis(batches, urls.length),
    });
  };
  
  const handleSaveScan = () => {
    const scanName = prompt("Enter a name for this scan:", new Date().toLocaleString());
    if (scanName) {
      const key = `scan_${scanName.replace(/\s/g, '_')}`;
      localStorage.setItem(key, JSON.stringify(results));
      loadScanList();
      Modal.success({ content: 'Scan saved!' });
    }
  };

  const handleLoadScan = (key) => {
    if (key) {
      const savedData = JSON.parse(localStorage.getItem(key));
      setResults(savedData);
    }
  };
  
  const exportAsXlsx = () => {
    const worksheetData = results.map(res => {
        const row = {
            'Original URL': res.originalURL,
            'Final URL': res.finalURL || 'N/A',
            'Hop Count': res.redirectChain?.length || 0,
            'Final Target Status': res.error ? 'Error' : res.redirectChain?.slice(-1)[0]?.status || 'N/A',
            'Total Time (s)': (res.totalTime || 0).toFixed(2),
            'Error': res.error || 'None',
        };
        res.redirectChain?.forEach((hop, index) => {
            const hopNum = index + 1;
            if (hopNum > 15) return; // Safety limit
            row[`Hop ${hopNum} URL`] = hop.url;
            row[`Hop ${hopNum} Status`] = hop.status;
            row[`Hop ${hopNum} Server`] = hop.server || 'Unknown';
        });
        return row;
    });
    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Redirect Scan");
    XLSX.writeFile(workbook, "redirect_scan.xlsx");
  };

  const getStatusTagClass = (status) => {
    if (!status || status === 'N/A') return 'status-tag-unknown';
    if (status === 'Error') return 'status-tag-error';
    const s = parseInt(status);
    if (s >= 500) return 'status-tag-5xx';
    if (s >= 400) return 'status-tag-4xx';
    if (s >= 300) return 'status-tag-3xx';
    if (s >= 200) return 'status-tag-2xx';
    return 'status-tag-unknown';
  };

  const getChainTagClass = (status) => {
    if (status >= 400) return 'chain-tag-4xx';
    if (status >= 300) return 'chain-tag-3xx';
    return 'chain-tag-2xx';
  };

  const columns = [
    {
      title: 'Original URL',
      dataIndex: 'originalURL',
      render: url => (
        <Tooltip title={url}>
          <span className="url-cell"><LinkOutlined style={{ color: '#475569', marginRight: 6 }} />{truncate(url, 40)}</span>
        </Tooltip>
      )
    },
    {
      title: 'Final URL',
      dataIndex: 'finalURL',
      render: url => (
        <Tooltip title={url}>
          <span className="url-cell">{truncate(url || 'N/A', 40)}</span>
        </Tooltip>
      )
    },
    {
      title: 'Status',
      key: 'status',
      width: 90,
      render: (_, record) => {
        const finalStatus = record.error ? 'Error' : record.redirectChain?.slice(-1)[0]?.status || 'N/A';
        return <span className={`status-tag ${getStatusTagClass(finalStatus)}`}>{finalStatus}</span>;
      }
    },
    {
      title: 'Redirect Chain',
      key: 'chain',
      render: (_, record) => (
        <Space size={4} wrap>
          {record.redirectChain?.slice(0, 5).map((hop, i) => (
            <span key={i} className={`chain-tag ${getChainTagClass(hop.status)}`}>{hop.status}</span>
          ))}
          {(record.redirectChain?.length || 0) > 5 && (
            <span className="chain-tag" style={{ background: 'rgba(100,116,139,0.1)', borderColor: 'rgba(100,116,139,0.2)', color: '#64748b' }}>
              +{record.redirectChain.length - 5}
            </span>
          )}
        </Space>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Button className="details-btn" icon={<BarChartOutlined />} onClick={() => setModalData(record)}>
          Details
        </Button>
      )
    },
  ];

  return (
    <div className="dashboard-page">
      <Card className="section-card" bordered={false}>
        {/* URL Input Header */}
        <div className="url-input-header">
          <ThunderboltOutlined style={{ color: '#06b6d4', fontSize: 18 }} />
          <div>
            <Title className="url-input-title" level={5}>Analyze URLs</Title>
            <Text className="url-input-subtitle">
              Enter one URL per line — up to {currentUser?.url_limit ?? '?'} URLs allowed
            </Text>
          </div>
        </div>

        {/* URL Textarea */}
        <TextArea
          className="url-textarea"
          rows={7}
          value={urlsInput}
          onChange={(e) => setUrlsInput(e.target.value)}
          placeholder={"https://example.com/short-link\nhttps://bit.ly/abc123\nhttps://t.co/xyz..."}
          disabled={isAnalyzing}
        />

        {/* URL Count Indicator */}
        {(() => {
          const urlCount = getValidUrlCount(urlsInput);
          const limit = currentUser?.url_limit;
          const isOver = limit && urlCount > limit;
          return urlCount > 0 ? (
            <div className="url-count-indicator">
              <Text style={{ fontSize: 12, color: isOver ? '#f87171' : '#94a3b8' }}>
                {isOver ? '⚠️ ' : ''}
                {urlCount} URL{urlCount !== 1 ? 's' : ''} entered
                {limit ? ` / ${limit} allowed` : ''}
                {isOver ? ' — Limit exceeded!' : ''}
              </Text>
            </div>
          ) : null;
        })()}

        {/* Action Bar */}
        {isAnalyzing ? (
          <div className="progress-section">
            {isBatchMode && batchInfo ? (
              /* ── Batch mode progress dashboard ── */
              <>
                <div className="batch-status-header">
                  <Text className="batch-status-text">
                    <SyncOutlined spin style={{ marginRight: 6 }} />
                    {batchInfo.statusText}
                  </Text>
                  <Text className="progress-timer">⏱ {formatTime(elapsedTime)}</Text>
                </div>

                <div className="batch-stats-grid">
                  <div className="batch-stat">
                    <span className="batch-stat-label">Batch</span>
                    <span className="batch-stat-value">{batchInfo.currentBatch} / {batchInfo.totalBatches}</span>
                  </div>
                  <div className="batch-stat">
                    <span className="batch-stat-label">Batch Progress</span>
                    <span className="batch-stat-value">{batchInfo.completedInBatch} / {batchInfo.batchUrls}</span>
                  </div>
                  <div className="batch-stat">
                    <span className="batch-stat-label">Total Done</span>
                    <span className="batch-stat-value">{progress} / {totalUrls}</span>
                  </div>
                  <div className="batch-stat">
                    <span className="batch-stat-label">Pending</span>
                    <span className="batch-stat-value">{totalUrls - progress}</span>
                  </div>
                </div>

                <Text className="progress-label" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                  Overall Progress — {totalUrls > 0 ? Math.round((progress / totalUrls) * 100) : 0}%
                </Text>
                <Progress
                  className="progress-bar"
                  percent={totalUrls > 0 ? Math.round((progress / totalUrls) * 100) : 0}
                  strokeColor={{ from: '#06b6d4', to: '#3b82f6' }}
                  trailColor="rgba(255,255,255,0.04)"
                  showInfo={false}
                />

                <Text className="progress-label" style={{ fontSize: 11, display: 'block', marginBottom: 6, marginTop: 12 }}>
                  Current Batch — {batchInfo.completedInBatch} / {batchInfo.batchUrls}
                </Text>
                <Progress
                  percent={batchInfo.batchUrls > 0 ? Math.round((batchInfo.completedInBatch / batchInfo.batchUrls) * 100) : 0}
                  strokeColor="#818cf8"
                  trailColor="rgba(255,255,255,0.04)"
                  showInfo={false}
                  size="small"
                />

                {batchInfo.countdown !== null && (
                  <div className="batch-countdown">
                    ⏳ Next batch starts in <span className="countdown-number">{batchInfo.countdown}s</span>
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <Button className="btn-stop" icon={<StopOutlined />} onClick={handleStopAnalysis}>
                    Stop Analysis
                  </Button>
                </div>
              </>
            ) : (
              /* ── Regular mode progress ── */
              <>
                <div className="progress-header">
                  <Text className="progress-label">
                    Analyzing {progress} / {totalUrls} URLs…
                  </Text>
                  <Text className="progress-timer">⏱ {formatTime(elapsedTime)}</Text>
                </div>
                <Progress
                  className="progress-bar"
                  percent={totalUrls > 0 ? Math.round((progress / totalUrls) * 100) : 0}
                  strokeColor={{ from: '#06b6d4', to: '#3b82f6' }}
                  trailColor="rgba(255,255,255,0.04)"
                  showInfo={false}
                />
                <div style={{ marginTop: 12 }}>
                  <Button className="btn-stop" icon={<StopOutlined />} onClick={handleStopAnalysis}>
                    Stop Analysis
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="action-bar">
            <Button className="btn-analyze" type="primary" icon={<RocketOutlined />} onClick={handleAnalyze}>
              Analyze URLs
            </Button>
            <Button className="btn-batch" icon={<SyncOutlined />} onClick={handleBatchAnalyze}>
              Batch Analysis
            </Button>
            <Select
              className="scan-select"
              placeholder="Load a saved scan…"
              options={savedScans}
              onChange={handleLoadScan}
            />
          </div>
        )}

        {/* Results Bar */}
        {results.length > 0 && !isAnalyzing && (
          <div className="results-bar">
            <Text className="results-count">
              <b>{results.length}</b> {results.length === 1 ? 'result' : 'results'} analyzed
            </Text>
            <Text className="results-time">Total time: {formatTime(elapsedTime)}</Text>
            <Space className="results-actions" size={8}>
              <Button className="btn-secondary" icon={<SaveOutlined />} onClick={handleSaveScan}>
                Save Scan
              </Button>
              <Button className="btn-secondary" icon={<DownloadOutlined />} onClick={exportAsXlsx}>
                Export Excel
              </Button>
            </Space>
          </div>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <div className="results-table-container">
            <Table
              className="results-table"
              columns={columns}
              dataSource={results}
              rowKey="originalURL"
              pagination={{ pageSize: 10, size: 'small' }}
            />
          </div>
        )}
      </Card>

      {modalData && <DetailsModal data={modalData} onClose={() => setModalData(null)} />}
    </div>
  );
}

function AppContent() {
  const [currentUser, setCurrentUser] = useState(() => {
    const savedUser = localStorage.getItem('currentUser');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  
  const [serverStatus, setServerStatus] = useState('checking');
  useEffect(() => {
    fetch("https://urj4.onrender.com/health")
      .then(response => {
        if (response.ok) setServerStatus('online');
        else setServerStatus('offline');
      })
      .catch(() => setServerStatus('offline'));
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('currentUser');
    setCurrentUser(null);
  };

  const handleLoginSuccess = (userData) => {
    const userWithActivity = { ...userData, lastActivity: Date.now() };
    localStorage.setItem('currentUser', JSON.stringify(userWithActivity));
    setCurrentUser(userWithActivity);
  };

  const statusClass = `status-badge status-${serverStatus}`;

  return (
    <Layout className="app-root">
      {/* ── Header ── */}
      <Header className="app-header">
        <div className="header-brand">
          <div className="header-logo-icon">🔗</div>
          <Title className="header-title" level={4}>URL Journey Analyzer</Title>
        </div>

        <div className="header-actions">
          {/* Backend status */}
          <div className={statusClass}>
            <span className="status-badge-dot" />
            {serverStatus === 'checking' ? 'Connecting…' : serverStatus === 'online' ? 'Backend Online' : 'Backend Offline'}
          </div>

          {/* GitHub */}
          <Tooltip title="View on GitHub">
            <a href="https://github.com/bindrakesh" target="_blank" rel="noopener noreferrer">
              <Button className="header-icon-btn" type="text" icon={<GithubOutlined style={{ fontSize: 18 }} />} />
            </a>
          </Tooltip>

          {/* User chip + logout */}
          {currentUser && (
            <>
              <div className="user-chip">
                <div className="user-avatar">
                  {currentUser.username?.[0]?.toUpperCase() || 'U'}
                </div>
                <span>
                  <b style={{ color: '#e2e8f0' }}>{currentUser.username}</b>
                  <span style={{ color: '#475569', marginLeft: 6, fontSize: 11 }}>
                    /{currentUser.url_limit} URLs
                  </span>
                </span>
              </div>
              <Tooltip title="Logout">
                <Button
                  className="header-icon-btn"
                  type="text"
                  icon={<LogoutOutlined style={{ fontSize: 16 }} />}
                  onClick={handleLogout}
                />
              </Tooltip>
            </>
          )}
        </div>
      </Header>

      {/* ── Main Content ── */}
      <Content className="app-main">
        {!currentUser ? (
          <LoginForm onLoginSuccess={handleLoginSuccess} />
        ) : (
          <AnalyzerView currentUser={currentUser} onLogout={handleLogout} />
        )}
      </Content>

      {/* ── Footer ── */}
      <Footer className="app-footer">
        <span className="footer-left">
          © {CURRENT_YEAR} <b>URL Journey Analyzer</b> — Trace every redirect, understand the path.
        </span>
        <div className="footer-right">
          <a
            href="https://github.com/bindrakesh"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            <GithubOutlined /> GitHub
          </a>
          <span className="footer-link" style={{ cursor: 'default' }}>
            Built with React + Ant Design
          </span>
        </div>
      </Footer>
    </Layout>
  );
}

const DetailsModal = ({ data, onClose }) => {
    const getHopTagClass = (status) => {
      if (status >= 400) return 'status-tag status-tag-4xx';
      if (status >= 300) return 'status-tag status-tag-3xx';
      return 'status-tag status-tag-2xx';
    };

    const chainSummary = (
        <Space size={4} wrap>
            {data.redirectChain?.map((hop, i) => (
              <span key={i} className={getHopTagClass(hop.status)}>{hop.status}</span>
            ))}
        </Space>
    );

    return (
        <Modal
          className="details-modal"
          title={
            <Space>
              <BarChartOutlined style={{ color: '#06b6d4' }} />
              <span>Analysis Details</span>
            </Space>
          }
          open={!!data}
          onCancel={onClose}
          footer={null}
          width={860}
        >
            <Descriptions bordered column={1} size="small" style={{ marginBottom: 20 }}>
                <Descriptions.Item label="Original URL">{data.originalURL}</Descriptions.Item>
                <Descriptions.Item label="Final URL">{data.finalURL || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Total Time">{(data.totalTime || 0).toFixed(2)} seconds</Descriptions.Item>
            </Descriptions>

            <Text className="modal-section-title">Redirect Chain</Text>

            <Collapse defaultActiveKey={['1']}>
                <Panel header={chainSummary} key="1">
                    <List
                        dataSource={data.redirectChain || []}
                        renderItem={(item, index) => (
                            <List.Item>
                                <List.Item.Meta
                                    avatar={
                                      <Avatar className="hop-avatar" style={{ backgroundColor: 'transparent' }}>
                                        {index + 1}
                                      </Avatar>
                                    }
                                    title={
                                      <Space size={8}>
                                        <span className={getHopTagClass(item.status)}>{item.status}</span>
                                        <span style={{ fontSize: 12, color: '#94a3b8', wordBreak: 'break-all' }}>{item.url}</span>
                                      </Space>
                                    }
                                    description={
                                      <span>
                                        <b>Server:</b> {item.server || 'Unknown'}&nbsp;&nbsp;|&nbsp;&nbsp;
                                        <b>Time:</b> {(item.timestamp || 0).toFixed(2)}s
                                      </span>
                                    }
                                />
                            </List.Item>
                        )}
                    />
                </Panel>
            </Collapse>

            <div className="mermaid-container">
              <Text className="modal-section-title" style={{ display: 'block', marginBottom: 16 }}>Flow Diagram</Text>
              <div className="mermaid" />
            </div>
        </Modal>
    );
};

const formatTime = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
};

const CURRENT_YEAR = new Date().getFullYear();

function App() { return (<ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}><AppContent /></ConfigProvider>); }
const truncate = (str, n) => (str && str.length > n) ? str.slice(0, n-1) + '…' : str;

export default App;