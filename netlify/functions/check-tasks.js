const fetch = require('node-fetch'); // O usa el fetch nativo de Node 18+

exports.handler = async function(event, context) {
    // Solo permitimos peticiones POST con los datos del usuario
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: "Método no permitido" }) };
    }

    try {
        const bodyData = JSON.parse(event.body);
        const { user, repo, token, folders } = bodyData;

        if (!user || !repo || !token || !folders) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Faltan datos o credenciales del usuario." })
            };
        }

        // Opcional: Leer o verificar el data.json actual desde el GitHub del usuario
        const githubApiUrl = `https://api.github.com/repos/${user}/${repo}/contents/data.json`;
        
        const now = new Date().getTime();
        let notificationsTriggered = [];

        // Función recursiva para procesar las tareas y detectar las que están a 45 minutos
        function processFolders(folderList) {
            folderList.forEach(f => {
                if (f.tasks) {
                    f.tasks.forEach(t => {
                        if (!t.done && t.dueDate && !t.notified) {
                            const dueTime = new Date(t.dueDate).getTime();
                            const notifyTime = dueTime - (45 * 60 * 1000); // 45 minutos antes
                            
                            if (now >= notifyTime && now < dueTime) {
                                notificationsTriggered.push({
                                    folderName: f.name,
                                    taskText: t.text,
                                    taskId: t.id
                                });
                                t.notified = true; // Marcar como notificado
                            }
                        }
                    });
                }
                if (f.subfolders) processFolders(f.subfolders);
            });
        }

        processFolders(folders);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                triggered: notificationsTriggered,
                updatedFolders: folders // Devuelve las carpetas con la tarea marcada como notificada
            })
        };

    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
};