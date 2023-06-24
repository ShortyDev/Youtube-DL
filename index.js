const express = require('express');
const app = express();
const port = 3000;
require('express-ws')(app);

const fs = require('fs');
const {exec} = require('child_process');

const regexPattern = /(?:\b|\/|v=|\.be\/)([a-zA-Z0-9_-]{11})(?:\b|&|-|$)/;

setInterval(() => {
    fs.readdir(__dirname, (err, files) => {
        if (err) {
            console.error(err);
            return;
        }
        files.forEach(file => {
            if (file.startsWith("dl-")) {
                const stats = fs.statSync(file);
                const now = new Date().getTime();
                const endTime = new Date(stats.mtime).getTime() + 10 * 60 * 1000;
                if (now > endTime) {
                    fs.rmdir(file, {recursive: true}, (err) => {
                        if (err) {
                            console.error(err);
                        }
                    });
                }
            }
        });
    })
    console.log("Cleaned up old downloads");
}, 60 * 1000);

app.ws('/download', function (ws, req) {
    ws.on('message', function (msg) {
        const randomId = Math.random().toString(36).substring(7);
        const audioOnly = msg.startsWith("audioOnly!");
        msg = msg.substring(audioOnly ? 10 : 0);
        const quality = msg.split("!")[1];
        if (quality && !quality.match(/^(144|240|360|480|720|1080|1440|2160|4320)$/)) {
            ws.send("ERR Invalid quality");
            return;
        }
        msg = msg.split("!")[0];
        const inputMatch = msg.match(regexPattern);
        const percentMatch = /(\d+(?:\.\d+)?)%/;
        if (inputMatch && inputMatch[1]) {
            const videoId = inputMatch[1];
            fs.mkdir("dl-" + videoId, {recursive: true}, (err) => {
                if (err) {
                    console.error(err);
                }
            });
            const ytDlp = exec(`yt-dlp -f '${audioOnly ? '' : 'bestvideo[height<=' + quality + ']+'}bestaudio' --merge-output-format mp4 -o "dl-${videoId + randomId}/out.mp4" --no-playlist https://www.youtube.com/watch?v=${videoId}`);
            let videoPercent = true;
            ytDlp.stdout.on('data', (data) => {
                if (data.includes("[download]")) {
                    const percent = data.match(percentMatch);
                    if (percent && percent[1]) {
                        const parsedPercent = parseFloat(percent[1]);
                        if (parsedPercent === 100) {
                            videoPercent = false;
                        }
                        ws.send("PROG:" + percent[1] + "!" + videoPercent);
                    }
                }
            })
            ytDlp.stderr.on('data', (data) => {
                if (data.includes("Video unavailable")) {
                    console.error(`stderr: ${data}`);
                    ws.send("ERR:Video unavailable");
                } else {
                    console.error(`stderr: ${data}`);
                    ws.send("ERR:Unknown error");
                }
                ytDlp.kill();
                ws.close();
            })
            ytDlp.on('close', (code) => {
                console.log(`child process exited with code ${code}`);
                ws.send("DONE:" + videoId + "!" + randomId);
                ws.close();
            })
        }
    });
})

app.get('/video/:id', (req, res) => {
    const raw = req.params.id;
    const input = raw.split("!")[0];
    const randomId = raw.split("!")[1];
    if (randomId.length > 10) {
        res.status(400).send("Invalid input");
        return;
    }
    const inputMatch = input.match(regexPattern);
    if (inputMatch && inputMatch[1]) {
        const videoId = inputMatch[1];
        if (!fs.existsSync(`dl-${videoId + randomId}/out.mp4`)) {
            res.status(404).send("File not found");
            return;
        }
        res.sendFile(`dl-${videoId + randomId}/out.mp4`, {root: __dirname});
    } else {
        res.status(400).send("Invalid input");
    }
})

app.get('/', (req, res) => {
    res.sendFile('index.html', {root: __dirname});
});

app.listen(port, () => console.log(`App listening on port ${port}!`));