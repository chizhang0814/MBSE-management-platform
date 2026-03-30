import { createContext, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

// 自动模式：6:00–18:00 为白天（light），其余为夜晚（dark）
function getAutoTheme(): 'light' | 'dark' {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? 'light' : 'dark';
}

function applyTheme(mode: ThemeMode) {
  const effective = mode === 'auto' ? getAutoTheme() : mode;
  if (effective === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  effectiveTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  setMode: () => {},
  effectiveTheme: 'light',
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem('themeMode') as ThemeMode) || 'light';
  });

  const effectiveTheme: 'light' | 'dark' = mode === 'auto' ? getAutoTheme() : mode;

  const setMode = (m: ThemeMode) => {
    localStorage.setItem('themeMode', m);
    setModeState(m);
    applyTheme(m);
  };

  useEffect(() => {
    applyTheme(mode);

    // 自动模式：每分钟检查一次时间，判断是否需要切换
    if (mode !== 'auto') return;
    const interval = setInterval(() => applyTheme('auto'), 60_000);
    return () => clearInterval(interval);
  }, [mode]);

  return (
    <ThemeContext.Provider value={{ mode, setMode, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
