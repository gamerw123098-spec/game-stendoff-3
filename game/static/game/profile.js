// Профиль игрока: код хранится в браузере, а кейсы и скины на сервере.
const KEY = 'poligon.profile';

export function storedCode() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function storeCode(code) {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Без хранилища (например, в приватном окне) профиль живёт до закрытия вкладки.
  }
}

export async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, data: await response.json() };
}

/** Загружает профиль или создаёт новый. При недоступном сервере возвращает null. */
export async function loadProfile() {
  try {
    const code = storedCode();
    let result = await api('/api/profile/', code ? { code } : {});
    if (result.status === 404) result = await api('/api/profile/', {});
    if (!result.ok) return null;
    storeCode(result.data.code);
    return result.data;
  } catch {
    return null;
  }
}
