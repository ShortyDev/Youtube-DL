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
        const percentMatch = /(\d{1,3}\.\d{1,2})%/;
        const videoUrl = msg.split("!")[0];
        if (videoUrl.includes(" ") || videoUrl.includes("\"") || videoUrl.includes("'")) {
            ws.send("ERR:Invalid URL");
            return;
        }
        let timing;
        let startTimeSec
        let endTimeSec
        if (msg.split("!").length === 3) {
            timing = msg.split("!")[2]
            if (timing.split(":").length !== 2) {
                ws.send("ERR:Invalid timing")
                ws.close()
                return;
            }
            startTimeSec = timing.split(":")[0]
            endTimeSec = timing.split(":")[1]
        }
        console.log("Downloading " + videoUrl + " to " + randomId + " with quality " + quality + " and audioOnly " + audioOnly);
        const ytDlp = exec(`yt-dlp -f '${audioOnly ? '' : 'bestvideo[height<=' + quality + ']+'}bestaudio' --merge-output-format mp4 -o "dl-${randomId}/out.mp4" --no-playlist ${videoUrl}`);
        setTimeout(() => {
            if (!fs.existsSync(`dl-${randomId}/out.mp4`)) {
                ws.send("ERR:Timeout");
                ytDlp.kill();
                ws.close();
            }
        }, 5 * 60 * 1000);
        ytDlp.stdout.on('data', (data) => {
            if (data.includes("[download]")) {
                const percent = data.match(percentMatch);
                if (percent && percent[1]) {
                    const parsedPercent = parseFloat(percent[1]);
                    ws.send("PROG:" + parsedPercent);
                }
            }
            ws.send("LOG:" + data);
        })
        ytDlp.stderr.on('data', (data) => {
            if (data.includes("Video unavailable")) {
                console.error(`stderr: ${data}`);
                ws.send("ERR:Video unavailable");
            } else {
                console.error(`stderr: ${data}`);
                ws.send("ERR:Unknown error");
            }
            ws.send("LOG:" + data);
            ytDlp.kill();
            ws.close();
        })
        ytDlp.on('close', (code) => {
            console.log(`[YT-DLP] child process exited with code ${code}`);
            if (timing) {
                const ffmpegCut = exec(`ffmpeg -y -i dl-${randomId}/out.mp4 -ss ${startTimeSec} -to ${endTimeSec} -c:v copy -c:a copy dl-${randomId}/out2.mp4`)
                ffmpegCut.stdout.on('data', (data) => {
                    ws.send("LOG:" + data)
                    console.log("ffmpeg post: " + data)
                })
                ffmpegCut.on('close', (code) => {
                    console.log(`[FFMPEG-POST] child process exited with code ${code}`);
                    ws.send("DONE:" + randomId);
                    ws.close();
                })
                return
            }
            ws.send("DONE:" + randomId);
            ws.close();
        })
    });
})

app.get('/video/:id', (req, res) => {
    const raw = req.params.id;
    if (raw.length > 10) {
        res.status(400).send("Invalid input");
        return;
    }
    const randomId = raw;
    const output2 = fs.existsSync(`dl-${randomId}/out2.mp4`)
    if (!fs.existsSync(`dl-${randomId}/out.mp4`)) {
        res.status(404).send("File not found");
        return;
    }
    res.sendFile(`dl-${randomId}/${output2 ? "out2.mp4" : "out.mp4"}`, {root: __dirname});
})

app.get('/', (req, res) => {
    res.sendFile('index.html', {root: __dirname});
});

app.listen(port, () => console.log(`App listening on port ${port}!`));