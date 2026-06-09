export const startOfDay = (dateStr: string): Date => {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    return d;
};

export const endOfDay = (dateStr: string): Date => {
    const d = new Date(dateStr);
    d.setHours(23, 59, 59, 999);
    return d;
};
