import axios from 'axios';

const API_URL = 'https://localhost:8000/api/v1/settings';

export const getSetting = async (key: string) => {
    const response = await axios.get(`${API_URL}/${key}`);
    return response.data;
};

export const upsertSetting = async (key: string, value: any) => {
    const response = await axios.post(API_URL, { key, value });
    return response.data;
}