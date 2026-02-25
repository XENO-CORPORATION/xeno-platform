export async function postXenoRequest<T = any>(
  path: string,
  payload: Record<string, any>
): Promise<T> {
  const token = localStorage.getItem('xenoos_auth_token');

  const requestOnce = async (body: Record<string, any>) => {
    const response = await fetch(`/api/xeno${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return { response, data };
  };

  const { response, data } = await requestOnce(payload);

  if (response.status === 402) {
    throw new Error(
      `Insufficient credits. Need ${data?.required ?? 'unknown'}, have ${data?.current ?? 'unknown'}`
    );
  }

  if (!response.ok) {
    const apiError = data?.error || `Request failed with status ${response.status}`;
    throw new Error(apiError);
  }

  return data as T;
}
