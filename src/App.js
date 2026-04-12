import React, { useState, useEffect, useRef } from 'react';
import mermaid from 'mermaid';
import { Layout, Input, Button, Table, Modal, Space, Select, Typography, Tag, Tooltip, Progress, ConfigProvider, theme, List, Descriptions, Collapse, Avatar } from 'antd';
import { DownloadOutlined, BarChartOutlined, StopOutlined, RocketOutlined, SaveOutlined, GithubOutlined, LogoutOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import './App.css';

const { Header, Content } = Layout;
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
    <Layout style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Space direction="vertical" style={{ width: 350, padding: 24, background: '#141414', borderRadius: 8 }}>
        <Title level={3} style={{ color: 'white', textAlign: 'center' }}>Access Analyzer</Title>
        <Input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
        <Input.Password placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onPressEnter={handleLogin} />
        {error && <Text type="danger">{error}</Text>}
        <Button type="primary" onClick={handleLogin} loading={loading} block>Login</Button>
      </Space>
    </Layout>
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
  const timerRef = useRef(null);
  const socketRef = useRef(null);


  const generateMermaidMarkup = (details) => {
    let markup = 'graph TD\n';
    const chain = details.redirectChain;
    if (!chain || chain.length === 0) {
      return `graph TD\n A[\"<b>${details.originalURL}</b><br/>${details.error ? `<span style='color:red'>Error: ${details.error}</span>` : 'No redirects.'}\"];`;
    }
    chain.forEach((hop, index) => {
        const id = `hop${index}`;
        const nodeText = `\"<b>${truncate(hop.url, 40)}</b><br/>Status: ${hop.status}<br/>Server: ${hop.server || 'Unknown'}\"`;
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
  
  const handleStopAnalysis = () => { if (socketRef.current) socketRef.current.close(); }
  
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

  const columns = [
    { title: 'Original URL', dataIndex: 'originalURL', render: url => <Tooltip title={url}>{truncate(url, 40)}</Tooltip> },
    { title: 'Final URL', dataIndex: 'finalURL', render: url => <Tooltip title={url}>{truncate(url || 'N/A', 40)}</Tooltip> },
    { title: 'Status', key: 'status', render: (_, record) => {
        const finalStatus = record.error ? 'Error' : record.redirectChain?.slice(-1)[0]?.status || 'N/A';
        const color = finalStatus >= 500 ? 'volcano' : finalStatus >= 400 ? 'red' : finalStatus >= 300 ? 'gold' : finalStatus >= 200 ? 'green' : 'grey';
        return <Tag color={color}>{finalStatus}</Tag>;
    }},
    { title: 'Redirect Chain', key: 'chain', render: (_, record) => (
        <Space size={[0, 8]} wrap>{record.redirectChain?.map((hop, i) => <Tag key={i} color="blue">{hop.status}</Tag>).slice(0, 5)}</Space>
    )},
    { title: 'Actions', key: 'actions', render: (_, record) => <Button icon={<BarChartOutlined />} onClick={() => setModalData(record)}>Details</Button> },
  ];

  return (
    <Layout>

      <Content style={{ padding: '50px' }}>
        <div className="content-inner">
          <Space direction="vertical" size="large" style={{width: '100%'}}>
            <TextArea rows={8} value={urlsInput} onChange={(e) => setUrlsInput(e.target.value)} placeholder="Enter one or more URLs..." disabled={isAnalyzing} />
             {isAnalyzing ? (
              <div className="analysis-controls">
                  <Progress percent={Math.round((progress / totalUrls) * 100)} />
                  <Space>
                    <Text>Elapsed Time: {formatTime(elapsedTime)}</Text>
                    <Button type="primary" danger icon={<StopOutlined/>} onClick={handleStopAnalysis}>Stop Analysis</Button>
                  </Space>
              </div>
            ) : (
              <Space style={{width: '100%'}}>
                <Button type="primary" icon={<RocketOutlined/>} onClick={handleAnalyze} block>Analyze URLs</Button>
                <Select placeholder="Load a saved scan..." options={savedScans} onChange={handleLoadScan} style={{width: '250px'}} />
              </Space>
            )}
            {results.length > 0 && !isAnalyzing && (
              <Space>
                <Text strong>Total Analysis Time: {formatTime(elapsedTime)}</Text>
                <Button icon={<SaveOutlined/>} onClick={handleSaveScan}>Save Scan</Button>
                <Button onClick={exportAsXlsx} icon={<DownloadOutlined />}>Export as Excel</Button>
              </Space>
            )}
            <Table columns={columns} dataSource={results} rowKey="originalURL" />
          </Space>
        </div>
      </Content>
      {modalData && <DetailsModal data={modalData} onClose={() => setModalData(null)} />}
    </Layout>
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

  return (
    <Layout>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Title level={2} style={{ color: 'white', margin: 0 }}>🔗 URL Journey Analyzer</Title>
        <Space align="center" size="middle">
          <Tag color={serverStatus === 'online' ? 'green' : serverStatus === 'offline' ? 'red' : 'orange'}>
            Backend Status: {serverStatus.charAt(0).toUpperCase() + serverStatus.slice(1)}
          </Tag>
          <Tooltip title="View on GitHub">
            <a href="https://github.com/bindrakesh" target="_blank" rel="noopener noreferrer">
              <GithubOutlined style={{ color: 'white', fontSize: '24px', verticalAlign: 'middle' }} />
            </a>
          </Tooltip>
          {currentUser && (
            <>
              <Tag>
                Welcome, <b>{currentUser.username}</b> (Limit: {currentUser.url_limit})
              </Tag>
              <Tooltip title="Logout">
                <Button type="text" icon={<LogoutOutlined style={{ color: 'white', fontSize: '20px' }} />} onClick={handleLogout}/>
              </Tooltip>
            </>
          )}
        </Space>
      </Header>

      <Content style={{ padding: '50px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
        {!currentUser ? (
          <LoginForm onLoginSuccess={handleLoginSuccess} />
        ) : (
          <AnalyzerView currentUser={currentUser} onLogout={handleLogout} />
        )}
      </Content>
    </Layout>
  );
}

const DetailsModal = ({ data, onClose }) => {
    const chainSummary = (
        <Space size={[0, 8]} wrap>
            {data.redirectChain?.map((hop, i) => <Tag key={i} color={hop.status >= 400 ? 'red' : hop.status >= 300 ? 'gold' : 'green'}>{hop.status}</Tag>)}
        </Space>
    );

    return (
        <Modal title="Analysis Details" open={!!data} onCancel={onClose} footer={null} width={900}>
            <Descriptions bordered column={1} size="small" style={{ marginBottom: '1rem'}}>
                <Descriptions.Item label="Original URL">{data.originalURL}</Descriptions.Item>
                <Descriptions.Item label="Final URL">{data.finalURL || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Total Time">{(data.totalTime || 0).toFixed(2)} seconds</Descriptions.Item>
            </Descriptions>
            <Collapse defaultActiveKey={['1']}>
                <Panel header={chainSummary} key="1">
                    <List
                        dataSource={data.redirectChain || []}
                        renderItem={(item, index) => (
                            <List.Item>
                                <List.Item.Meta
                                    avatar={<Avatar style={{ backgroundColor: '#1677ff' }}>{index + 1}</Avatar>}
                                    title={<><Tag color={item.status >= 400 ? 'red' : item.status >= 300 ? 'gold' : 'green'}>{item.status}</Tag> {item.url}</>}
                                    description={<><b>Server:</b> {item.server || 'Unknown'} | <b>Time:</b> {(item.timestamp || 0).toFixed(2)}s</>}
                                />
                            </List.Item>
                        )}
                    />
                </Panel>
            </Collapse>
        </Modal>
    );
};

const formatTime = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
};

function App() { return (<ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}><AppContent /></ConfigProvider>); }
const truncate = (str, n) => (str && str.length > n) ? str.slice(0, n-1) + '…' : str;

export default App;