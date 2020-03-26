const prompts = require('prompts');
require('dotenv').config();

const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;

const jiraBaseUrl = `https://${process.env.JIRA_DOMAIN}.atlassian.net`;
const jiraIssueBaseUrl = `${jiraBaseUrl}/browse`;

const axiosGH = require('axios').create({
    baseURL: `https://api.github.com/repos/${owner}/${repo}/`,
    headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`
    }
});
const axiosJIRA = require('axios').create({
    baseURL: `${jiraBaseUrl}/rest/api/3`,
    headers: {
        'Authorization': `Basic ${process.env.JIRA_TOKEN}`
    }
});

const mergePR = async (pullNumber) => {
    console.log("mergePR:", pullNumber);
    const res = await axiosGH.put(`/pulls/${pullNumber}/merge`).catch(e => {
        throw new Error(e);
    });
    return res.data;
};

const getReleaseByTagName = async (tag) => {
    console.log("getReleaseByTagName:", tag);
    const res = await axiosGH.get(`/releases/tags/${tag}`).catch(e => {
        throw new Error(e);
    });
    return res.data;
};

const getReleaseById = async (releaseId) => {
    console.log("getReleaseById:", releaseId);
    const res = await axiosGH.get(`/releases/${releaseId}`).catch(e => {
        throw new Error(e);
    });
    return res.data;
};

const deleteRelease = async (releaseId) => {
    console.log("deleteRelease:", releaseId);
    await axiosGH.delete(`/releases/${releaseId}`).catch(e => {
        throw new Error(e);
    });
};

const deleteTag = async (tag) => {
    console.log("deleteTag:", tag);
    const res = await axiosGH.delete(`/git/refs/tags/${tag}`).catch(e => {
        throw new Error(e);
    });
    console.log(res);
};

const createRelease = async (data = {
    "tag_name": "",
    "name": "",
    "body": "",
    "draft": "",
    "prerelease": ""
}) => {
    console.log("createRelease:", data);
    const res = await axiosGH.post(`/releases`, data).catch(e => {
        throw new Error(e);
    });
    return res.data;
};

/**
 *
 * @returns {Promise<Array>}
 */
const getReleases = async () => {
    const res = await axiosGH.get(`/releases`).catch(e => {
        throw new Error(e);
    });
    return res.data;
};

const patchRelease = async (releaseId, data) => {
    console.log("patchRelease:", releaseId, data);
    const res = await axiosGH.patch(`/releases/${releaseId}`, data).catch(e => {
        throw new Error(e);
    });
    return res.data;
};

const recreateReleaseByTag = async () => {
    const releases = await getReleases();
    const {value: targetRelease} = await prompts(({
        type: "select",
        name: 'value',
        message: "Releaseを選択",
        choices: releases.map(r => ({
            title: r.name,
            value: r
        }))
    }));
    const releaseData = {
        "tag_name": targetRelease.tag_name,
        "name": targetRelease.name,
        "body": targetRelease.body,
        "draft": targetRelease.draft,
        "prerelease": targetRelease.prerelease
    };
    console.log(releaseData);
    await deleteRelease(targetRelease.id);
    await deleteTag(targetRelease.tag_name);
    const release = await createRelease(releaseData);
    console.log(release);
};

const pickJiraIssue = async (query) => {
    console.log("pickJiraIssue", query);
    const res = await axiosJIRA.get("/issue/picker", {params: {query: query}});
    return res.data.sections[0].issues;
};

const changePrereleaseToFalse = async () => {
    const releases = await getReleases();
    // TODO api でfilterできない？
    const prereleases = releases.filter(r => r.prerelease);
    if (!prereleases.length) {
        console.log("対象がない");
        process.exit(0);
        return;
    }
    const {value} = await prompts(({
        type: "multiselect",
        name: 'value',
        message: "Releaseを選択",
        choices: prereleases.map(r => ({
            title: r.name,
            value: r
        }))
    }));
    value.forEach(v => patchRelease(v.id, {prerelease: false}));
};

const getPRs = async () => {
    const res = await axiosGH.get(`/pulls`).catch(e => {
        throw new Error(e);
    });
    return res.data;
};

const getPR = async (pullNumber) => {
    console.log("getPR", pullNumber);
    const res = await axiosGH.get(`/pulls/${pullNumber}`).catch(e => {
        throw new Error(e);
    });
    return res.data;
};

const mergeAndCreateRelease = async () => {
    const releases = await getReleases();

    // TODO merge blockだからダメ

    const prs = await getPRs();
    const targetPrs = prs.filter(pr =>
        pr.labels.some(
            l => ["merge_ready"].includes(l.name)
        )
    );
    if (!targetPrs.length) {
        console.log("merge_readyなPRはありません");
        process.exit(0);
        return;
    }
    const {pr} = await prompts(({
        type: "select",
        name: 'pr',
        message: "PRを選択",
        choices: targetPrs.map(pr => ({
            title: pr.title,
            value: pr
        }))
    }));

    const prDetail = await getPR(pr.number);
    if(!prDetail.mergeable){
        console.log("mergeableじゃないみたいです");
        process.exit(0);
        return;
    }

    const matched = pr.title.match(/\[(.+?)]/);
    const jiraNoMaybe = matched.length >= 2 ? matched[1] : null;

    const jiraIssue = jiraNoMaybe ? await pickJiraIssue(jiraNoMaybe).then(issues => issues.length > 0 ? issues[0] : null) : null;

    const {tagName} = await prompts(({
        type: 'text',
        name: 'tagName',
        message: 'タグ名',
        initial: "" // TODO 自動で入れたい
    }));
    const {name} = await prompts(({
        type: 'text',
        name: 'name',
        message: `リリース名`,
        initial: jiraIssue ? `[${jiraNoMaybe}] ${jiraIssue.summaryText}` : pr.title
    }));
    const {body} = await prompts(({
        type: 'text',
        name: 'body',
        message: "リリースボディ",
        initial: jiraIssue ? `${jiraIssueBaseUrl}/${jiraIssue.key}` : ''
    }));
    const {draft} = await prompts(({
        type: 'toggle',
        name: 'draft',
        message: "draft？",
        initial: true,
        active: 'True',
        inactive: 'False'
    }));
    const {prerelease} = await prompts(({
        type: 'toggle',
        name: 'prerelease',
        message: "prerelease？",
        initial: true,
        active: 'True',
        inactive: 'False'
    }));

    const releaseData = {
        "tag_name": tagName,
        "name": name,
        "body": body,
        "draft": draft,
        "prerelease": prerelease
    };

    console.log(releaseData);
    const {yes} = await prompts(({
        type: 'toggle',
        name: 'prerelease',
        message: "これでマージしてからリリース作ります",
        initial: true,
        active: 'yes',
        inactive: 'no'
    }));
    if (!yes) {
        process.exit(0);
        return;
    }
    console.log(yes);
    // await mergePR(pr.number);
    // const release = await createRelease(releaseData);
    // console.log(release)
};

const main = async () => {
    const actionChoices = [
        {
            title: "prerelease外す",
            description: "prereleaseなリリースたちから選択してprereleaseを外す",
            value: {
                func: changePrereleaseToFalse,
            }
        },
        {
            title: "リリース作り直し",
            description: "既存のタグ付きリリースのタグとリリースを消す。そのリリースと同じリリースを新しく作る。その際タグは現在のmasterに同じ名前で打つ",
            value: {
                func: recreateReleaseByTag,
            }
        },
        {
            title: "PRをマージしてリリース作る",
            description: "merge_readyなPRをマージしてJIRAのデータを元にいい感じのリリース作る",
            value: {
                func: mergeAndCreateRelease,
            }
        },
    ];
    const {value} = await prompts({
        type: 'select',
        name: 'value',
        message: 'Pick a command',
        choices: Object.values(actionChoices),
    });
    await value.func();
};

(async () => {
    try {
        await main();
    } catch (err) {
        console.log(err);
    }
})();
